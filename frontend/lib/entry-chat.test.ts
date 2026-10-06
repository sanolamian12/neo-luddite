import assert from "node:assert/strict";
import { test } from "node:test";
import * as routes from "./account-route";
import { SEED_ADMIN, SEED_AUDITOR, SEED_VIEWER } from "./account-schema";

// These tests catch discarded free text, lost drafts, duplicate retries and account leakage.
async function storeFactory() {
  const chatModule = await import("./entry-chat").catch(() => null);
  assert.equal(typeof chatModule?.createEntryChatStore, "function", "local chat store must exist");
  return chatModule!.createEntryChatStore;
}

function memoryStorage() {
  const items = new Map<string, string>();
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); }, removeItem: (key: string) => { items.delete(key); } };
}

test("typed questions and unsent drafts survive reload without network access", async () => {
  const create = await storeFactory();
  const storage = memoryStorage();
  const store = create(storage);
  await store.persist.rehydrate();
  store.getState().setLandingDraft("guest", "리스 차량을 주말에 가족과 같이 씁니다.");
  const id = store.getState().create("guest");
  await store.getState().send(id, "guest");
  store.getState().setDraft(id, "guest", "운행 기록도 있어요");
  const restored = create(storage);
  await restored.persist.rehydrate();
  const conversation = restored.getState().conversations[0];
  assert.equal(conversation.id, id);
  assert.equal(conversation.messages[0].segments[0].text, "리스 차량을 주말에 가족과 같이 씁니다.");
  assert.match(conversation.messages[1].segments[0].text, /차량|운행/);
  assert.equal(conversation.draft, "운행 기록도 있어요");
});

test("handoff adopts only the current guest chat once and isolates other owners", async () => {
  const create = await storeFactory();
  const store = create(memoryStorage());
  const current = store.getState().create("guest");
  const other = store.getState().create("guest");
  store.getState().setDraft(current, "guest", "작성 중인 질문");
  store.getState().adopt(current, "viewer:viewer");
  store.getState().adopt(current, "viewer:viewer");
  store.getState().adopt(current, "viewer:owner2");
  store.getState().setDraft(current, "viewer:owner2", "다른 계정의 질문");
  assert.equal(await store.getState().send(current, "viewer:owner2"), false);
  assert.equal(store.getState().conversations.length, 2);
  assert.equal(store.getState().conversations.find((c) => c.id === current)?.scope, "viewer:viewer");
  assert.equal(store.getState().conversations.find((c) => c.id === current)?.draft, "작성 중인 질문");
  assert.equal(store.getState().conversations.find((c) => c.id === other)?.scope, "guest");
});

test("an error retries the same user turn and a late reply stays with its conversation", async () => {
  const create = await storeFactory();
  const store = create(memoryStorage());
  const id = store.getState().create("guest");
  store.getState().setDraft(id, "guest", "직원 헬스장 비용이 궁금해요");
  await store.getState().send(id, "guest", "error");
  assert.equal(store.getState().conversations[0].messages.length, 1);
  assert.ok(store.getState().errors[id]);
  const response = store.getState().retry(id, "guest");
  const other = store.getState().create("guest");
  store.getState().adopt(id, "auditor:auditor2");
  await response;
  assert.deepEqual(store.getState().conversations.find((c) => c.id === id)?.messages.map((m) => m.role), ["user", "assistant"]);
  assert.equal(store.getState().conversations.find((c) => c.id === other)?.messages.length, 0);
  assert.equal(store.getState().conversations.find((c) => c.id === id)?.scope, "auditor:auditor2");
});

test("duplicate submissions are ignored and landing drafts transfer on login", async () => {
  const create = await storeFactory();
  const store = create(memoryStorage());
  store.getState().setLandingDraft("guest", "거래처와 골프를 쳤어요");
  store.getState().adopt(undefined, "admin:admin");
  assert.equal(store.getState().landingDrafts["admin:admin"], "거래처와 골프를 쳤어요");
  assert.equal(store.getState().landingDrafts.guest, undefined);
  const id = store.getState().create("admin:admin");
  const first = store.getState().send(id, "admin:admin");
  assert.equal(await store.getState().send(id, "admin:admin"), false);
  await first;
  assert.equal(store.getState().conversations[0].messages.length, 2);
});

test("corrupt or unavailable storage still allows local chat", async () => {
  const create = await storeFactory();
  for (const getItem of [() => "{bad json", () => { throw new Error("Storage blocked"); }]) {
    const store = create({ getItem, setItem() { throw new Error("Quota exceeded"); }, removeItem() {} });
    await store.persist.rehydrate();
    assert.equal(store.persist.hasHydrated(), true);
    const id = store.getState().create("guest");
    store.getState().setDraft(id, "guest", "처음 상담합니다");
    await store.getState().send(id, "guest");
    assert.equal(store.getState().conversations[0].messages.length, 2);
  }
});

test("login returns to chat for every role and rejects foreign or unauthorized destinations", () => {
  assert.equal(typeof routes.destinationAfterLogin, "function");
  for (const account of [SEED_VIEWER, SEED_AUDITOR, SEED_ADMIN]) {
    assert.equal(routes.destinationAfterLogin(account, "/chat/clinic?c=local-123"), "/chat/clinic?c=local-123");
    assert.equal(routes.destinationAfterLogin(account, "https://outside.test"), routes.routeForAccount(account));
    assert.equal(routes.destinationAfterLogin(account, "//outside.test"), routes.routeForAccount(account));
    assert.equal(routes.destinationAfterLogin(account, "/\\outside.test"), routes.routeForAccount(account));
    assert.equal(routes.destinationAfterLogin(account, "/login?next=/login"), routes.routeForAccount(account));
  }
  assert.equal(routes.destinationAfterLogin(SEED_VIEWER, "/admin/dashboard"), "/chat/clinic");
  assert.equal(routes.destinationAfterLogin(SEED_VIEWER, "/consultations"), "/consultations");
  assert.equal(routes.destinationAfterLogin(SEED_AUDITOR), "/audit/dashboard");
  assert.equal(routes.destinationAfterLogin(SEED_ADMIN), "/admin/dashboard");
});

test("live responder receives prior history and its reply keeps blocks with the next order", async () => {
  const create = await storeFactory();
  const seen: { history: number; last: string }[] = [];
  const store = create(memoryStorage(), "populated", async (conversation) => {
    seen.push({ history: conversation.messages.length - 1, last: conversation.messages.at(-1)!.segments[0].text });
    return { id: "srv-1", role: "assistant", order: 99, segments: [{ id: "s1", text: "조건부로 인정될 수 있어요.", type: "conclusion" }], uiBlocks: [{ kind: "expert_handoff", reason: "자문" }] };
  });
  const id = store.getState().create("guest");
  store.getState().setDraft(id, "guest", "차량 리스료가 궁금해요");
  assert.equal(await store.getState().send(id, "guest"), true);
  const [user, reply] = store.getState().conversations[0].messages;
  assert.deepEqual(seen, [{ history: 0, last: "차량 리스료가 궁금해요" }]);
  assert.equal(user.role, "user");
  assert.equal(reply.order, 1, "server order is replaced by the local position");
  assert.equal(reply.uiBlocks?.[0].kind, "expert_handoff");
});

test("a failed live reply keeps the question and retry asks again", async () => {
  const create = await storeFactory();
  let calls = 0;
  const store = create(memoryStorage(), "populated", async () => {
    calls++;
    if (calls === 1) throw new Error("/api/chat 503");
    return { id: "srv-2", role: "assistant", order: 0, segments: [{ id: "s2", text: "답변", type: "conclusion" }] };
  });
  const id = store.getState().create("guest");
  store.getState().setDraft(id, "guest", "질문");
  assert.equal(await store.getState().send(id, "guest"), false);
  assert.ok(store.getState().errors[id]);
  assert.equal(store.getState().conversations[0].messages.length, 1);
  assert.equal(await store.getState().retry(id, "guest"), true);
  assert.equal(store.getState().conversations[0].messages.length, 2);
  assert.equal(calls, 2);
});

test("restoring a server conversation adds it once and never overwrites a local copy", async () => {
  const create = await storeFactory();
  const store = create(memoryStorage());
  const message = { id: "m1", role: "user" as const, order: 0, segments: [{ id: "s1", text: "다른 기기에서 한 질문", type: "question" as const }] };
  const restored = { id: "local-remote", scope: "viewer:owner-1", occupation: "clinic" as const, createdAt: 1, updatedAt: 2, messages: [message] };
  store.getState().restore(restored);
  store.getState().setDraft("local-remote", "viewer:owner-1", "이어서 쓰는 중");
  store.getState().restore({ ...restored, messages: [] });
  const [conversation] = store.getState().conversations;
  assert.equal(store.getState().conversations.length, 1);
  assert.equal(conversation.messages.length, 1);
  assert.equal(conversation.draft, "이어서 쓰는 중");
});

test("the first sample reply persists sources and every supported response block", async () => {
  const create = await storeFactory();
  const storage = memoryStorage();
  const store = create(storage);
  await store.persist.rehydrate();
  const id = store.getState().create("guest");
  store.getState().setDraft(id, "guest", "리스 차량을 가족과도 사용합니다");
  await store.getState().send(id, "guest");
  const reply = store.getState().conversations[0].messages[1];
  assert.ok(reply.segments.some((segment) => segment.citations?.length), "sample reply includes visible source metadata");
  assert.deepEqual(reply.uiBlocks?.map((block) => block.kind), ["verdict_card", "evidence_checklist", "expert_handoff"]);
  assert.match(JSON.stringify(reply.uiBlocks), /예시|샘플/);
  const restored = create(storage);
  await restored.persist.rehydrate();
  assert.deepEqual(restored.getState().conversations[0].messages[1], reply);
});

test("existing text-only sample replies gain UI without losing their text, IDs or drafts", async () => {
  const create = await storeFactory();
  const storage = memoryStorage();
  const saved = { id: "local-existing", scope: "guest", occupation: "clinic", createdAt: 1, updatedAt: 2, draft: "작성 중인 답변", messages: [
    { id: "q", role: "user", order: 0, segments: [{ id: "q-text", type: "question", text: "직원 복지 비용 문의" }] },
    { id: "a", role: "assistant", order: 1, segments: [{ id: "a-text", type: "follow_up", text: "모든 직원이 이용하나요?" }] },
  ] };
  storage.setItem("prototype-entry-chat-v1:populated", JSON.stringify({ version: 1, state: { conversations: [saved], landingDrafts: {} } }));
  const store = create(storage);
  await store.persist.rehydrate();
  const conversation = store.getState().conversations[0];
  assert.equal(conversation.draft, saved.draft);
  assert.equal(conversation.messages[1].id, "a");
  assert.equal(conversation.messages[1].segments[0].id, "a-text");
  assert.equal(conversation.messages[1].segments[0].text, saved.messages[1].segments[0].text);
  assert.equal(conversation.messages[1].uiBlocks?.length, 3);
  assert.deepEqual(conversation.messages[0], saved.messages[0]);
});

test("live replies are stored as returned and never receive sample cards on reload", async () => {
  const create = await storeFactory();
  const storage = memoryStorage();
  const respond = async () => ({ id: "srv-3", role: "assistant" as const, order: 0, segments: [{ id: "s3", text: "금액을 알려 주세요.", type: "follow_up" as const }] });
  const store = create(storage, "populated", respond);
  await store.persist.rehydrate();
  const id = store.getState().create("guest");
  store.getState().setDraft(id, "guest", "회식비 처리");
  await store.getState().send(id, "guest");
  assert.equal(store.getState().conversations[0].messages[1].uiBlocks, undefined, "live reply without blocks stays without blocks");
  const reloaded = create(storage, "populated", respond);
  await reloaded.persist.rehydrate();
  const reply = reloaded.getState().conversations[0].messages[1];
  assert.equal(reply.uiBlocks, undefined, "hydration does not add sample verdict/evidence cards to live replies");
  assert.ok(!reply.segments.some((segment) => segment.citations?.includes("상담 준비 안내 · 가상 출처 예시")));
});
