import { z } from "zod";
import { withDemoPortrait } from "./expert-identity";
import { agentSchema, createAgent } from "../agent-studio";
import { createPractice, practiceSchema, retrieveCases } from "../agent-practice";
import { approveSubmittedContribution, boardSchema, contributionSchema, createContribution, emptyBoard, emptyPayload, reviewContribution, submitContribution } from "../knowledge-contributions";
import { expertCardSchema, type ExpertCard } from "../poc-schema";
import { learningSessionSchema } from "../session-learning-schema";
import { applySessionLesson, proposeLesson } from "../session-learning";

export const sceneIds = ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "B1", "B2", "B3", "B4", "B5", "C1", "C2", "C3", "C4", "C5"] as const;
export type Scene = typeof sceneIds[number];
export const sceneLabels: Record<Scene, string> = { A1: "공통 AI에게 질문", A2: "상황 확인", A3: "세무사 선택", A4: "세무사의 AI와 상담", A5: "직접 검토 요청", A6: "세무사가 직접 답변", A7: "상담 완료", B1: "가르치는 방법", B2: "상담에서 대화 선택", B3: "검토하고 가르치기", B4: "가르치기 전후 비교", B5: "선택한 지식 공유", C1: "전문가 제안 검토", C2: "업데이트 배치 구성", C3: "공통 지식 반영", C4: "작성자 기여 크레딧", C5: "공통 AI에서 확인" };
export const script = {
  opening: "병원에서 상담용으로 산 태블릿을 집에서도 써요. 이것도 비용처리가 될까요?",
  facts: "진료 설명과 상담 자료를 보여줄 때 쓰고, 집에서는 가족도 사용해요. 구입 영수증은 있어요.",
  followup: "어떤 자료부터 준비하면 되나요?",
  missing: "영수증은 있는데 사용 기록은 없어요. 제가 기억하는 비율로 정리하면 될까요?",
  human: "지금부터 제가 직접 확인하겠습니다. 비율을 먼저 정하기보다, 남아 있는 상담 자료와 사용 상황을 함께 살펴보죠. 확인할 수 있는 자료부터 알려 주세요.",
  customerReply: "영수증과 태블릿에 남아 있는 상담 자료부터 준비할게요. 사용 기록이 없는 부분은 어떻게 정리하면 될까요?",
  humanFollowup: "좋습니다. 영수증과 실제 상담에 사용한 자료를 보내 주세요. 확인한 사실과 추가로 필요한 내용을 나누어 정리한 뒤 다시 안내드리겠습니다.",
  customerThanks: "네, 말씀하신 자료부터 준비하겠습니다. 확인해 주셔서 감사합니다.",
  probe: "상담용 노트북을 집에도 가져가는데 사용 기록은 따로 없어요.",
  judgment: "고객이 기억하는 사용 상황과 자료로 확인할 수 있는 내용을 나누어 검토합니다. 고객 진술만으로 확인이 끝났다고 표시하지 않습니다.",
  conclusion: "확인된 내용, 추가로 필요한 자료, 세무사가 검토할 부분을 나누어 안내합니다. 사용 기록이 부족하면 기억에 따른 비율로 결론을 정하지 않고 남아 있는 상담 자료부터 함께 검토합니다.",
  questions: "어떤 업무에 사용했나요?\n개인적으로도 사용하나요?\n업무 사용을 확인할 수 있는 자료가 있나요?",
};
const messageSchema = z.object({ id: z.string(), author: z.enum(["customer", "common_ai", "expert_ai", "expert", "system"]), name: z.string(), text: z.string().max(6000), at: z.string(), kind: z.literal("welcome").optional(), interrupted: z.boolean().optional(), knowledgeId: z.string().optional() });
const manifestSchema = z.object({ contributionId: z.string(), revision: z.number().int(), entry: contributionSchema });
const batchSchema = z.object({ id: z.string(), name: z.string().min(1), baseVersion: z.number().int(), targetVersion: z.number().int(), status: z.enum(["prepared", "applying", "complete", "failed"]), createdAt: z.string(), completedAt: z.string().optional(), error: z.string().optional(), items: z.array(manifestSchema).min(1) });
export const demoRunSchema = z.object({
  version: z.literal(1), id: z.string().regex(/^[\w-]{1,100}$/), revision: z.number().int().nonnegative(), updatedAt: z.string(), scene: z.enum(sceneIds), generation: z.number().int().default(0), lastPath: z.string().optional(),
  commonDraft: z.string().max(4000).default(script.probe), commonQuery: z.string().max(4000).default(""),
  conversationId: z.string(), messages: z.array(messageSchema).max(120), completed: z.boolean(), sourceRevision: z.number().int().optional(),
  controller: z.enum(["common_ai", "expert_ai", "expert"]), presence: z.enum(["not_joined", "observing"]), requested: z.boolean(), recommended: z.boolean(), expertId: z.string().optional(),
  experts: z.array(expertCardSchema), agent: agentSchema.extend({ practice: practiceSchema }), beforePractice: practiceSchema,
  pending: z.object({ id: z.string(), reply: z.string(), visibleChars: z.number().int().nonnegative().optional(), kind: z.literal("welcome").optional(), author: z.enum(["common_ai", "expert_ai"]), knowledgeId: z.string().optional(), request: z.boolean(), recommend: z.boolean() }).optional(),
  pendingCustomer: z.object({ id: z.string(), reply: z.string(), replyTo: z.string() }).optional(),
  customerDraft: z.string().max(4000), expertDraft: z.string().max(4000), selection: z.object({ opened: z.boolean(), mode: z.enum(["all", "selected"]), ids: z.array(z.string()), permitted: z.boolean() }),
  board: boardSchema, reviewer: z.object({ id: z.string(), name: z.string(), role: z.literal("reviewer") }), batches: z.array(batchSchema), kbVersion: z.number().int(),
  credits: z.array(z.object({ id: z.string(), contributionId: z.string(), revision: z.number().int(), authorId: z.string(), author: z.string(), batchId: z.string(), kbVersion: z.number().int(), amount: z.number(), at: z.string(), reversalOf: z.string().optional() })),
});
export type DemoRun = z.infer<typeof demoRunSchema>;
export type DemoMessage = z.infer<typeof messageSchema>;
export function nextDemoLine(run: DemoRun, speaker: "customer" | "expert"): { text: string } | null {
  if (run.completed || run.pending || run.pendingCustomer) return null;
  if (speaker === "expert") {
    if (run.controller !== "expert") return null;
    const replies = run.messages.filter(message => message.author === "expert").length;
    return replies < 2 ? { text: replies ? script.humanFollowup : script.human } : null;
  }
  if (run.controller === "expert" || run.requested) return null;
  if (!run.messages.length) return { text: script.opening };
  if (!run.expertId) return run.recommended ? null : { text: script.facts };
  const replied = run.messages.some(message => message.author === "expert_ai" && message.kind !== "welcome" && !message.interrupted);
  return { text: replied ? script.missing : script.followup };
}
const now = () => new Date().toISOString();
export function demoHref(path: string, runId: string) {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("앱 내부 경로만 사용할 수 있습니다.");
  const url = new URL(path, "https://demo.invalid"); url.searchParams.set("demo", runId);
  return `${url.pathname}${url.search}${url.hash}`;
}
export function expert(run: DemoRun) { return run.experts.find((item) => item.auditorId === run.expertId) ?? run.experts[0]; }
export function createDemoRun(id = crypto.randomUUID() as string): DemoRun {
  const experts: ExpertCard[] = ["윤서진", "김도현", "이수민"].map<ExpertCard>((name, index) => ({ auditorId: `demo-expert-${index + 1}`, displayName: `${name} 세무사`, bio: index === 0 ? "병의원 상담 · 사용 내역과 증빙을 먼저 확인합니다. 가상 인물입니다." : "사업자의 상황과 자료를 차근차근 살펴봅니다. 가상 인물입니다.", qualifications: ["세무사 · 가상 프로필"], specialties: index === 0 ? ["병의원", "장비·증빙"] : ["소상공인", "사업 상담"], yearsExperience: 8 + index, availability: "available", contacts: { phone: { visibility: "hidden" }, email: { visibility: "hidden" }, kakao: { visibility: "hidden" } }, likeCount: 0, likedByMe: false, reviewedCount: 0, reviewedThisCase: false })).map(withDemoPortrait);
  const practice = createPractice();
  practice.cases.push({ ...practice.cases[0], id: "private-clinic-policy", title: "병의원 상담의 자료 준비 순서 · 기존 비공개 지식", origin: "expert", priority: "preferred", keywords: "태블릿, 병원, 장비", conclusion: "업무에 사용한 상황, 개인 사용을 구분할 기록, 구입 증빙 순서로 정리해 주세요. 기록이 남아 있는 항목부터 함께 확인하겠습니다." });
  const agent = { ...createAgent(experts[0].auditorId), id: "demo-clinic-agent", name: "윤서진 세무사의 AI", practice };
  let board = emptyBoard();
  for (const [index, author] of experts.slice(1).entries()) {
    const actor = { id: author.auditorId, name: author.displayName, role: "expert" as const };
    const payload = { ...emptyPayload(), title: index === 0 ? "구입 증빙을 확인하는 상담 순서 · 준비된 제안" : "자료 부족 시 추가 확인 · 보완이 필요한 제안", facts: "구입 영수증은 있지만 사용 목적을 확인할 자료가 부족한 상황", judgment: index === 0 ? "구입 사실과 사용 목적을 나누어 확인합니다." : "자료의 적용 범위를 더 구체적으로 정리할 필요가 있습니다.", conclusion: index === 0 ? "영수증의 구입 일자와 사용 목적을 확인할 자료를 함께 준비해 주세요." : "추가 자료를 확인합니다.", keywords: "영수증, 자료", scope: "장비 구입 자료를 준비하는 첫 상담", sources: "가상 상담 경험을 정리한 시연용 제안. 법령 판단을 포함하지 않습니다." };
    board = createContribution(board, { sourceId: `seed-${index}`, agentId: `seed-agent-${index}`, payload }, actor);
    const entry = board.entries.at(-1)!;
    board = submitContribution(board, entry.id, actor, { privacy: true, permission: true }, entry.version);
  }
  return demoRunSchema.parse({ version: 1, id, revision: 0, updatedAt: now(), scene: "A1", conversationId: `conversation-${id}`, messages: [], completed: false, controller: "common_ai", presence: "not_joined", requested: false, recommended: false, experts, agent, beforePractice: structuredClone(practice), customerDraft: "", expertDraft: "", selection: { opened: false, mode: "all", ids: [], permitted: false }, board, reviewer: { id: "demo-admin", name: "운영자 · 시연", role: "reviewer" }, batches: [], kbVersion: 0, credits: [] });
}
function append(run: DemoRun, author: DemoMessage["author"], text: string, knowledgeId?: string): DemoRun {
  const name = author === "customer" ? "고객" : author === "common_ai" ? "공통 AI" : author === "expert_ai" ? run.agent.name : author === "expert" ? `${expert(run).displayName} · 직접 답변` : "상담 안내";
  return { ...run, messages: [...run.messages, { id: crypto.randomUUID(), author, name, text, at: now(), knowledgeId }] };
}
export function sendMessage(run: DemoRun, author: "customer" | "expert", input: string): DemoRun {
  const text = input.trim();
  if (!text || run.completed) throw new Error("진행 중인 상담에 답변을 입력해 주세요.");
  if (run.pending) throw new Error("응답을 기다리거나 직접 참여해 주세요.");
  if (author === "expert" && run.pendingCustomer) throw new Error("고객의 답변을 기다려 주세요.");
  if (author === "expert" && run.controller !== "expert") throw new Error("직접 답변 시작을 먼저 선택해 주세요.");
  let next = append(run, author, text);
  next = { ...next, pendingCustomer: undefined, customerDraft: author === "customer" ? "" : run.customerDraft, expertDraft: author === "expert" ? "" : run.expertDraft };
  if (author === "expert") return { ...next, pendingCustomer: { id: crypto.randomUUID(), replyTo: next.messages.at(-1)!.id, reply: run.messages.some(message => message.author === "expert") ? script.customerThanks : script.customerReply } };
  if (run.controller === "expert") return next;
  const common = run.controller === "common_ai";
  const hasFacts = /가족|개인|집/.test(text) && /영수증|증빙/.test(text);
  const missing = /기록.*없|기록.*부족|기억|비율/.test(text);
  const match = retrieveCases(run.agent.practice, `${text} 태블릿`)[0];
  const reply = common ? hasFacts ? "업무와 개인 사용이 섞여 있어 실제 사용 내역을 함께 검토하면 좋겠습니다. 병의원 상담을 하는 세무사와 이어가시겠어요?" : /태블릿|장비|노트북/.test(text) ? "어떤 업무에 쓰시나요? 개인적으로 사용하는 경우와 구입 증빙이 있는지도 알려 주세요." : "장비의 사용 목적과 준비한 자료를 조금 더 알려 주세요." : missing ? "기억하시는 내용과 확인할 수 있는 자료를 구분해 두겠습니다. 기록이 부족한 부분은 세무사님이 직접 살펴보도록 요청하겠습니다." : `앞서 말씀하신 상황을 이어서 살펴보겠습니다.\n\n${match?.conclusion ?? run.agent.practice.introduction}`;
  return { ...next, scene: common ? hasFacts ? "A3" : "A2" : missing ? "A5" : "A4", pending: { id: crypto.randomUUID(), reply, author: common ? "common_ai" : "expert_ai", knowledgeId: common ? undefined : match?.id, request: !common && missing, recommend: common && hasFacts } };
}
export function finishReply(run: DemoRun, token: string, chunkSize?: number): DemoRun {
  const pending = run.pending;
  if (!pending || pending.id !== token || run.completed || run.controller !== pending.author) return run;
  if (chunkSize !== undefined) {
    const visibleChars = Math.min(Array.from(pending.reply).length, (pending.visibleChars ?? 0) + Math.max(0, Math.floor(chunkSize)));
    if (visibleChars < Array.from(pending.reply).length) return { ...run, pending: { ...pending, visibleChars } };
  }
  const next = append(run, pending.author, pending.reply, pending.knowledgeId);
  if (pending.kind) next.messages[next.messages.length - 1].kind = pending.kind;
  return { ...next, pending: undefined, requested: run.requested || pending.request, recommended: run.recommended || pending.recommend };
}
export function finishCustomerReply(run: DemoRun, token: string): DemoRun {
  const pending = run.pendingCustomer;
  if (!pending || pending.id !== token) return run;
  const next = { ...run, pendingCustomer: undefined };
  if (run.completed || run.controller !== "expert" || run.customerDraft.trim() || run.messages.at(-1)?.id !== pending.replyTo) return next;
  return append(next, "customer", pending.reply);
}
export function selectExpert(run: DemoRun, id: string): DemoRun {
  if (!run.recommended || run.expertId || run.pending) throw new Error("세무사 추천 이후 선택해 주세요.");
  const selected = run.experts.find((item) => item.auditorId === id);
  if (!selected) throw new Error("세무사를 선택해 주세요.");
  const next = append({ ...run, expertId: id, controller: "expert_ai", presence: "observing", scene: "A4", agent: { ...run.agent, owner: id, name: `${selected.displayName}의 AI` } }, "system", `${selected.displayName}와 세무사의 AI가 참여했습니다. 앞선 대화가 그대로 이어집니다.`);
  return { ...next, pending: { id: crypto.randomUUID(), author: "expert_ai", kind: "welcome", visibleChars: 0, request: false, recommend: false, reply: `안녕하세요. ${selected.displayName}의 AI입니다.\n\n앞서 나누신 대화를 이어받았어요. ${selected.bio.replace("가상 인물입니다.", "").trim()} 확인된 사실과 더 필요한 자료를 구분해 함께 살펴보겠습니다.\n\n세무사님도 이 대화에 함께합니다. 어떤 점부터 더 살펴볼까요?` } };

}
export function takeOver(run: DemoRun): DemoRun {
  if (!run.expertId || run.completed) throw new Error("진행 중인 세무사 상담이 필요합니다.");
  if (run.controller === "expert") return run;
  if (run.pending?.visibleChars) {
    const partial = Array.from(run.pending.reply).slice(0, run.pending.visibleChars).join("");
    run = append(run, run.pending.author, partial, run.pending.knowledgeId);
    run.messages[run.messages.length - 1].interrupted = true;
  }
  return append({ ...run, controller: "expert", pending: undefined, requested: false, scene: "A6" }, "system", "세무사가 직접 답변합니다. AI 응답은 잠시 멈춥니다.");
}
export function returnToAgent(run: DemoRun): DemoRun {
  if (run.completed || run.controller !== "expert") throw new Error("직접 답변 중인 상담에서만 AI에게 돌려줄 수 있습니다.");
  return append({ ...run, controller: "expert_ai", pendingCustomer: undefined }, "system", "세무사가 AI에게 상담을 이어 맡겼습니다.");
}
export function completeConsultation(run: DemoRun): DemoRun {
  if (!run.messages.some((item) => item.author === "expert")) throw new Error("직접 답변을 남긴 뒤 상담을 완료해 주세요.");
  return { ...run, completed: true, pending: undefined, pendingCustomer: undefined, sourceRevision: run.revision, scene: "A7" };
}
export function teachingSource(run: DemoRun, mode: "all" | "selected", ids: string[]) {
  if (!run.completed) throw new Error("완료한 상담을 선택해 주세요.");
  const messages = run.messages.filter((item) => item.author !== "system" && (mode === "all" || ids.includes(item.id)));
  if (!messages.length) throw new Error("가르칠 대화를 선택해 주세요.");
  if (!messages.some((item) => item.author === "customer") || !messages.some((item) => item.author === "expert")) throw new Error("고객의 사실과 세무사의 직접 답변을 함께 선택해 주세요.");
  return learningSessionSchema.parse({ id: run.conversationId, title: "업무·개인 사용이 섞인 장비의 사실 확인", kind: "chat", permitted: true, createdAt: now(), source: { conversationId: run.conversationId, revision: run.sourceRevision ?? run.revision, mode, messageIds: messages.map((item) => item.id) }, turns: messages.map((item) => ({ id: item.id, speaker: item.author === "customer" ? "client" : item.author === "expert" ? "expert" : "agent", text: item.text, authorName: item.name, at: item.at })) });
}
export function commonAnswer(run: DemoRun, query: string) {
  const entry = run.board.entries.find((item) => item.status === "published" && run.batches.some((batch) => batch.status === "complete" && batch.items.some((manifest) => manifest.contributionId === item.id)) && item.payload.keywords.split(/[,\n]/).some((keyword) => keyword.trim() && query.includes(keyword.trim())));
  return entry ? { text: entry.payload.conclusion, questions: entry.payload.questions, source: { id: entry.id, author: entry.author.name, title: entry.payload.title, version: run.kbVersion } } : { text: "사용 목적과 준비한 자료를 알려 주세요. 업무와 개인 사용을 구분할 수 있는지 함께 살펴보겠습니다.", questions: "", source: undefined };
}
export function createBatch(run: DemoRun, ids: string[], name: string): DemoRun {
  if (!name.trim() || !ids.length) throw new Error("배치 이름과 검토한 제안을 선택해 주세요.");
  if (run.batches.some((batch) => batch.status !== "complete")) throw new Error("기존 배치를 먼저 완료해 주세요.");
  const entries = [...new Set(ids)].map((id) => run.board.entries.find((item) => item.id === id));
  if (entries.some((item) => !item || item.status !== "approved" || !item.revisions.length)) throw new Error("검토 완료한 제안만 배치에 넣을 수 있습니다.");
  if (entries.some((item) => JSON.stringify(item!.payload) !== JSON.stringify(item!.revisions.at(-1)!.payload))) throw new Error("검토한 제출본과 내용이 다릅니다. 다시 검토해 주세요.");
  const batch = batchSchema.parse({ id: crypto.randomUUID(), name: name.trim(), baseVersion: run.kbVersion, targetVersion: run.kbVersion + 1, status: "prepared", createdAt: now(), items: entries.map((entry) => ({ contributionId: entry!.id, revision: entry!.revisions.at(-1)!.number, entry: structuredClone(entry) })) });
  return { ...run, scene: "C3", batches: [...run.batches, batch], board: { ...run.board, sequence: run.board.sequence + 1, entries: run.board.entries.map((item) => ids.includes(item.id) ? { ...item, status: "batched", version: item.version + 1, history: [...item.history, { id: crypto.randomUUID(), type: "batched", actor: run.reviewer, at: now(), note: `${batch.name} 배치에 포함했습니다.`, revision: item.revisions.at(-1)!.number }] } : item) } };
}
export function incorporateBatch(run: DemoRun, id: string): DemoRun {
  const batch = run.batches.find((item) => item.id === id);
  if (!batch) throw new Error("배치를 찾을 수 없습니다.");
  if (batch.status === "complete") return run;
  if (batch.baseVersion !== run.kbVersion) throw new Error("공통 지식 버전이 변경되었습니다.");
  for (const item of batch.items) {
    const current = run.board.entries.find((entry) => entry.id === item.contributionId);
    if (!current || current.status !== "batched" || current.revisions.at(-1)?.number !== item.revision || JSON.stringify(current.revisions.at(-1)?.payload) !== JSON.stringify(item.entry.payload) || JSON.stringify(current.payload) !== JSON.stringify(item.entry.payload) || current.author.id !== item.entry.author.id) throw new Error("검토한 제출본이 변경되었습니다. 배치를 다시 확인해 주세요.");
  }
  const at = now();
  const credits = batch.items.filter((item) => !run.credits.some((credit) => credit.id === `${run.id}:${item.contributionId}:${item.revision}`)).map((item) => ({ id: `${run.id}:${item.contributionId}:${item.revision}`, contributionId: item.contributionId, revision: item.revision, authorId: item.entry.author.id, author: item.entry.author.name, batchId: id, kbVersion: batch.targetVersion, amount: 1, at }));
  return { ...run, scene: "C4", kbVersion: batch.targetVersion, credits: [...run.credits, ...credits], batches: run.batches.map((item) => item.id === id ? { ...item, status: "complete", completedAt: at, error: undefined } : item), board: { ...run.board, sequence: run.board.sequence + 1, entries: run.board.entries.map((entry) => {
    const included = batch.items.find((item) => item.contributionId === entry.id);
    return included ? { ...entry, status: "published", version: entry.version + 1, publication: { id, version: batch.targetVersion, revision: included.revision, at }, credit: { id: `${run.id}:${entry.id}:${included.revision}`, status: "eligible", basis: `${id}@${batch.targetVersion}`, at }, history: [...entry.history, { id: crypto.randomUUID(), type: "published", actor: run.reviewer, at, note: `${batch.name}에 반영했습니다.`, revision: included.revision }] } : entry;
  }) } };
}
export function reconcileRetractions(run: DemoRun): DemoRun {
  const additions = run.credits.filter((credit) => credit.amount > 0 && run.board.entries.find((entry) => entry.id === credit.contributionId)?.status === "retracted" && !run.credits.some((item) => item.reversalOf === credit.id)).map((credit) => ({ ...credit, id: `reversal:${credit.id}`, amount: -credit.amount, at: now(), reversalOf: credit.id }));
  return additions.length ? { ...run, kbVersion: run.kbVersion + 1, credits: [...run.credits, ...additions] } : run;
}
/** One persisted transaction: approve the submitted snapshot, publish it, and credit its author. */
export function approveAndPublish(run: DemoRun, id: string, version: number, note = ""): DemoRun {
  const entry = run.board.entries.find(item => item.id === id);
  if (!entry) throw new Error("제안을 찾을 수 없습니다.");
  if (run.reviewer.id === entry.author.id) throw new Error("작성자와 다른 검토자가 승인해야 합니다.");
  if (entry.status === "published" && run.credits.some(credit => credit.contributionId === id && credit.revision === entry.publication?.revision)) return run;
  if (entry.version !== version) throw new Error("제안이 변경되었습니다. 최신 내용을 확인해 주세요.");
  const board = entry.status === "approved" ? run.board : approveSubmittedContribution(run.board, id, run.reviewer, version, note);
  const prepared = createBatch({ ...run, board }, [id], `${entry.payload.title} · 승인 반영`);
  return incorporateBatch(prepared, prepared.batches.at(-1)!.id);
}
export function preparedLesson(run: DemoRun): DemoRun {
  const draft = run.agent.practice.learning?.draft;
  if (!draft) return run;
  return { ...run, agent: { ...run.agent, practice: { ...run.agent.practice, learning: { ...run.agent.practice.learning!, draft: { ...draft, judgment: script.judgment, conclusion: script.conclusion, questions: script.questions, scope: "업무·개인 용도로 함께 사용하는 장비의 자료 준비 상담", exceptions: "자료와 설명이 다르거나 기록이 부족하면 세무사가 직접 검토합니다.", keywords: "태블릿, 노트북, 장비, 사용 기록", scenario: script.probe, expected: "기억과 확인 가능한 자료를 구분하고 세무사 검토를 요청합니다.", tested: false, evidenceConfirmed: false } } } } };
}
/** Populate the local demo's review examples while keeping selected quotations intact. */
export function createTeachingDraft(run: DemoRun): DemoRun {
  if (!run.selection.permitted) throw new Error("이 상담을 가르치기에 사용할 권한을 확인해 주세요.");
  const draft = proposeLesson(teachingSource(run, run.selection.mode, run.selection.ids));
  const next = preparedLesson({ ...run, scene: "B3", beforePractice: run.agent.practice, agent: { ...run.agent, practice: { ...run.agent.practice, learning: { sessions: run.agent.practice.learning?.sessions ?? [], draft } } } });
  const learning = next.agent.practice.learning!;
  return { ...next, agent: { ...next.agent, practice: { ...next.agent.practice, learning: { ...learning, draft: { ...learning.draft!, conclusion: draft.conclusion || learning.draft!.conclusion, questions: draft.questions || learning.draft!.questions } } } } };
}
export function restoreCheckpoint(original: DemoRun, scene: Scene): DemoRun {
  let run = createDemoRun(original.id);
  const target = sceneIds.indexOf(scene);
  const exchange = (text: string) => { run = sendMessage(run, "customer", text); run = finishReply(run, run.pending!.id); };
  if (target >= 1) exchange(script.opening);
  if (target >= 2) exchange(script.facts);
  if (target >= 3) { run = selectExpert(run, run.experts[0].auditorId); run = finishReply(run, run.pending!.id); }
  if (target >= 4) { exchange(script.followup); exchange(script.missing); }
  if (target >= 5) run = takeOver(run);
  if (target >= 6) { run = sendMessage(run, "expert", script.human); run = finishCustomerReply(run, run.pendingCustomer!.id); run = completeConsultation(run); }
  if (target >= 8) run.selection = { opened: true, mode: "selected", ids: run.messages.filter((item) => item.author === "expert" || item.text === script.facts || item.text === script.missing).map((item) => item.id), permitted: false };
  if (target >= 9) { run.selection.permitted = true; run.agent.practice.learning = { sessions: [], draft: proposeLesson(teachingSource(run, "selected", run.selection.ids)) }; run = preparedLesson(run); }
  if (target >= 10) { const draft = run.agent.practice.learning!.draft!; run.agent.practice = applySessionLesson(run.agent.practice, { ...draft, tested: true, evidenceConfirmed: true }); }
  if (target >= 12) {
    const draft = run.agent.practice.learning!.draft!;
    const actor = { id: run.agent.owner, name: expert(run).displayName, role: "expert" as const };
    run.board = createContribution(run.board, { agentId: run.agent.id, sourceId: draft.id, payload: { ...emptyPayload(), ...Object.fromEntries(Object.keys(emptyPayload()).filter((key) => key in draft).map((key) => [key, draft[key as keyof typeof draft]])), sources: "가상 상담의 검토된 지식. 고객 원문은 공유하지 않습니다." } }, actor);
    const entry = run.board.entries.at(-1)!;
    run.board = submitContribution(run.board, entry.id, actor, { privacy: true, permission: true }, entry.version);
  }
  if (target >= 13) {
    const checks = { evidence: true, privacy: true, duplicates: true, applicability: true };
    for (const [index, entry] of run.board.entries.entries()) run.board = reviewContribution(run.board, entry.id, run.reviewer, index === 1 ? "changes" : "approve", index === 1 ? "적용 범위를 더 구체적으로 정리해 주세요." : "근거와 적용 범위를 확인했습니다.", checks, entry.version);
  }
  if (target >= 14) run = createBatch(run, run.board.entries.filter((entry) => entry.status === "approved").map((entry) => entry.id), "병의원 상담 지식 업데이트 01");
  if (target >= 15) run = incorporateBatch(run, run.batches[0].id);
  return { ...run, scene, revision: original.revision, generation: original.generation + 1 };
}
export function scenePath(run: DemoRun, scene: Scene) {
  const agent = `agent=${run.agent.id}`;
  const path = scene === "C5" ? "/chat/clinic?common=1" : scene === "C4" ? "/audit/ledger" : scene === "C3" || scene === "C2" ? "/admin/knowledge-contributions/batches" : scene === "C1" ? "/admin/knowledge-contributions" : scene === "B5" ? `/audit/contributions?${agent}&case=${run.agent.practice.learning?.draft?.id ?? ""}` : scene === "B4" ? `/audit/agents/preview?${agent}` : scene.startsWith("B") ? `/audit/agents/teach?${agent}&method=session` : scene === "A6" || scene === "A7" ? `/audit/consultations?${agent}&kind=participation` : `/chat/clinic?c=${run.conversationId}`;
  return demoHref(path, run.id);
}
