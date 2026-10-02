import assert from "node:assert/strict";
import { after, test } from "node:test";

// Even copied live settings must never connect the prototype to a real backend.
process.env.NEXT_PUBLIC_DATA_MODE = "prototype";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://live-backend.example.com";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "live-placeholder";
process.env.NEXT_PUBLIC_API_BASE = "https://live-api.example.com";
const originalFetch = globalThis.fetch;
let networkAttempts = 0;
globalThis.fetch = async () => {
  networkAttempts++;
  throw new Error("Unexpected network request from prototype");
};
after(() => {
  globalThis.fetch = originalFetch;
  assert.equal(networkAttempts, 0, "prototype must stay entirely local");
});

test("guest chats become one owner record with the original messages for consultation handoff", async () => {
  const adapter = await import("./entry-chat-owner").catch(() => null);
  assert.equal(typeof adapter?.saveOwnerConversation, "function", "owner handoff adapter must exist");
  const { createEntryChatStore } = await import("./entry-chat");
  const { getSupabase } = await import("./supabase/client");
  const { useAccountStore } = await import("./account-store");
  await useAccountStore.getState().login("owner", "demo1234");
  const store = createEntryChatStore();
  const id = store.getState().create("guest");
  store.getState().setDraft(id, "guest", "차량 비용을 정리하고 싶어요");
  await store.getState().send(id, "guest");
  await assert.rejects(() => adapter!.saveOwnerConversation(store.getState().conversations[0]), /owner/i);
  store.getState().adopt(id, "viewer:viewer");
  await adapter!.saveOwnerConversation(store.getState().conversations[0]);
  await adapter!.saveOwnerConversation(store.getState().conversations[0]);
  const { data } = await getSupabase().from("conversations").select("*").eq("id", id);
  assert.equal(data?.length, 1);
  assert.equal(data![0].owner_id, "viewer");
  assert.equal(data![0].source, "prototype");
  const { useConversationStore } = await import("./conversation-store");
  assert.equal(useConversationStore.getState().records.find((record) => record.id === id)?.source, "prototype");
  assert.equal(data![0].payload.messages[0].segments[0].text, "차량 비용을 정리하고 싶어요");
  await useAccountStore.getState().login("owner2", "demo1234");
  await assert.rejects(() => adapter!.saveOwnerConversation(store.getState().conversations[0]), /owner/i);
  await useAccountStore.getState().logout();
});

test("demo login accepts each role, rejects invalid credentials, and logs out offline", async () => {
  const { useAccountStore } = await import("./account-store");
  for (const [username, role] of [["owner", "viewer"], ["auditor2", "auditor"], ["admin", "admin"]]) {
    assert.equal(await useAccountStore.getState().login(username, "wrong"), null);
    assert.equal(await useAccountStore.getState().login(username, "demo1234"), role);
    assert.equal(useAccountStore.getState().session, role);
    if (username === "auditor2") assert.equal(useAccountStore.getState().auditor.id, "auditor2");
    await useAccountStore.getState().logout();
    assert.equal(useAccountStore.getState().session, null);
  }
});

test("expert directory has enough sample records to exercise search and pagination", async () => {
  const { listExperts, toggleLike } = await import("../services/expert");
  const cards = await listExperts(null);
  assert.ok(cards.length > 6);
  assert.ok(cards.some((card) => card.availability === "busy"));
  const before = cards.find((card) => card.auditorId === "auditor")!;
  assert.ok(before.displayName);
  const liked = await toggleLike("auditor", "clinic-vehicle");
  assert.equal(liked.liked, true);
  assert.equal(liked.likeCount, before.likeCount + 1);
  const after = (await listExperts(null)).find((card) => card.auditorId === "auditor")!;
  assert.equal(after.likedByMe, true);
});

test("local collection writes can be read, edited and deleted through the existing client", async () => {
  const { getSupabase } = await import("./supabase/client");
  const client = getSupabase();
  const inserted = await client.from("auditors").insert({ id: "test-expert", display_name: "Prototype expert", qualifications: [], status: "active" }).select().single();
  assert.equal(inserted.error, null);
  assert.equal(inserted.data.id, "test-expert");
  assert.equal((await client.from("auditors").update({ display_name: "Updated expert" }).eq("id", "test-expert")).error, null);
  const updated = await client.from("auditors").select("*").eq("id", "test-expert").maybeSingle();
  assert.equal(updated.data?.display_name, "Updated expert");
  await client.from("auditors").delete().eq("id", "test-expert");
  assert.equal((await client.from("auditors").select("*").eq("id", "test-expert").maybeSingle()).data, null);
});

test("knowledge reads are local and unsupported operations fail explicitly", async () => {
  const { listKb2Documents } = await import("../services/kb2");
  const { apiFetch } = await import("./api-fetch");
  const result = await listKb2Documents();
  assert.ok(result.documents.length > 0);
  const response = await apiFetch("https://live-api.example.com/admin/kb2/synthesize", { method: "POST" });
  assert.equal(response.status, 501);
  assert.match((await response.json()).message, /prototype/i);
});

test("sample mailbox records conform to the UI domain schema", async () => {
  const { getSupabase } = await import("./supabase/client");
  const { rowToMail } = await import("./mail-store");
  const { mailSchema } = await import("./poc-schema");
  const { data, error } = await getSupabase().from("mail").select("*");
  assert.equal(error, null);
  assert.ok(data?.length);
  for (const row of data!) assert.equal(mailSchema.safeParse(rowToMail(row)).success, true);
});

test("prototype replay offers an expert handoff and a local consultation can be restored", async () => {
  const { getConversation } = await import("./load-conversation");
  const conversation = getConversation("clinic-vehicle")!;
  assert.ok(conversation.messages.some((message) => message.uiBlocks?.some((block) => block.kind === "expert_handoff")));
  const consultation = await import("../services/consultation");
  const created = await consultation.request({ conversationId: "clinic-golf", viewerId: "viewer", expertId: "auditor2", message: "Sample consultation" });
  const restored = await consultation.findActiveForConversation("clinic-golf");
  assert.equal(restored?.id, created.id);
  assert.equal(restored?.status, "pending");
});
