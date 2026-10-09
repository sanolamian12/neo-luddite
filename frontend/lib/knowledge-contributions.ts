import { z } from "zod";

const text = z.string().max(6000);
const actorSchema = z.object({ id: z.string().min(1), name: z.string().min(1).max(100), role: z.enum(["expert", "reviewer"]) });
export type ContributionActor = z.infer<typeof actorSchema>;
export const contributionPayloadSchema = z.object({ title: z.string().max(100), facts: text, judgment: text, conclusion: text, exceptions: text, questions: text, keywords: z.string().max(500), scope: text, sources: text, kind: z.enum(["case", "question", "correction"]) });
export type ContributionPayload = z.infer<typeof contributionPayloadSchema>;
const eventSchema = z.object({ id: z.string(), type: z.enum(["created", "edited", "submitted", "changes", "declined", "approved", "batched", "published", "retracted"]), actor: actorSchema, at: z.string(), note: text, revision: z.number().int(), checks: z.object({ evidence: z.boolean(), privacy: z.boolean(), duplicates: z.boolean(), applicability: z.boolean() }).optional() });
export const contributionSchema = z.object({
  id: z.string(), sourceId: z.string(), agentId: z.string(), author: actorSchema, version: z.number().int().positive(),
  payload: contributionPayloadSchema, status: z.enum(["draft", "pending", "changes", "declined", "approved", "batched", "published", "retracted"]),
  revisions: z.array(z.object({ number: z.number().int(), at: z.string(), payload: contributionPayloadSchema, privacy: z.literal(true), permission: z.literal(true) })).max(100),
  history: z.array(eventSchema).max(500),
  publication: z.object({ id: z.string(), version: z.number().int(), revision: z.number().int(), at: z.string() }).optional(),
  credit: z.object({ id: z.string(), status: z.enum(["eligible", "reversed"]), basis: z.string(), at: z.string() }).optional(),
});
export const boardSchema = z.object({ version: z.literal(1), sequence: z.number().int().nonnegative(), entries: z.array(contributionSchema).max(500) });
export type Contribution = z.infer<typeof contributionSchema>;
export type ContributionBoard = z.infer<typeof boardSchema>;
export type ReviewChecks = { evidence: boolean; privacy: boolean; duplicates: boolean; applicability: boolean };
export const contributionStatus: Record<Contribution["status"], string> = { draft: "초안", pending: "검토 중", changes: "수정 요청", declined: "미반영", approved: "검토 완료 · 반영 대기", batched: "배치에 포함", published: "반영됨", retracted: "반영 철회" };
export const contributionKind = { case: "답변 사례", question: "확인 질문", correction: "기존 지식 정정" };
export const emptyPayload = (): ContributionPayload => ({ title: "", facts: "", judgment: "", conclusion: "", exceptions: "", questions: "", keywords: "", scope: "", sources: "", kind: "case" });
export const emptyBoard = (): ContributionBoard => ({ version: 1, sequence: 0, entries: [] });
function event(type: Contribution["history"][number]["type"], actor: ContributionActor, note: string, revision: number): Contribution["history"][number] {
  return { id: crypto.randomUUID(), type, actor: actorSchema.parse(actor), at: new Date().toISOString(), note: note.trim(), revision };
}
function selected(board: ContributionBoard, id: string, version: number): Contribution {
  const entry = board.entries.find((item) => item.id === id);
  if (!entry) throw new Error("기여 내역을 찾을 수 없습니다.");
  if (entry.version !== version) throw new Error("다른 화면에서 변경되었습니다. 최신 내역을 확인하고 다시 시도해 주세요.");
  return entry;
}
function authored(entry: Contribution, actor: ContributionActor) {
  if (actor.role !== "expert" || actor.id !== entry.author.id) throw new Error("작성자만 초안을 수정하거나 제출할 수 있습니다.");
  if (entry.status !== "draft" && entry.status !== "changes") throw new Error("초안 또는 수정 요청 상태에서만 변경할 수 있습니다.");
}
function replace(board: ContributionBoard, next: Contribution): ContributionBoard {
  return boardSchema.parse({ ...board, sequence: board.sequence + 1, entries: board.entries.map((entry) => entry.id === next.id ? next : entry) });
}
export function createContribution(board: ContributionBoard, input: { agentId: string; sourceId: string; payload: ContributionPayload }, actor: ContributionActor): ContributionBoard {
  if (actor.role !== "expert") throw new Error("전문가 계정으로 제안해 주세요.");
  if (board.entries.some((entry) => entry.author.id === actor.id && entry.sourceId === input.sourceId)) throw new Error("이 지식으로 만든 제안이 이미 있습니다. 기존 기여 내역을 확인해 주세요.");
  const entry: Contribution = { id: crypto.randomUUID(), agentId: input.agentId, sourceId: input.sourceId, author: actorSchema.parse(actor), version: 1, payload: contributionPayloadSchema.parse(input.payload), status: "draft", revisions: [], history: [event("created", actor, "공유할 별도 초안을 만들었습니다.", 0)] };
  return boardSchema.parse({ ...board, sequence: board.sequence + 1, entries: [...board.entries, entry] });
}
export function editContribution(board: ContributionBoard, id: string, actor: ContributionActor, payload: ContributionPayload, version: number): ContributionBoard {
  const entry = selected(board, id, version); authored(entry, actor);
  const history = entry.history.at(-1)?.type === "edited" ? entry.history.slice(0, -1) : entry.history;
  return replace(board, { ...entry, version: entry.version + 1, payload: contributionPayloadSchema.parse(payload), history: [...history, event("edited", actor, "공유 초안을 수정했습니다.", entry.revisions.length)] });
}
export function submitContribution(board: ContributionBoard, id: string, actor: ContributionActor, acknowledgments: { privacy: boolean; permission: boolean }, version: number): ContributionBoard {
  const entry = selected(board, id, version); authored(entry, actor);
  const p = entry.payload;
  if (![p.title, p.scope, p.sources, p.judgment, p.keywords].every((value) => value.trim()) || (p.kind === "question" ? !p.questions.trim() : !p.facts.trim() || !p.conclusion.trim())) throw new Error("제목, 적용 범위, 근거, 판단 이유, 검색어와 제안 내용을 채워 주세요.");
  if (!acknowledgments.privacy || !acknowledgments.permission) throw new Error("개인정보 제거와 공유 권한을 확인해 주세요.");
  const content = Object.values(p).join("\n");
  if (/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|01[016789][- .]?\d{3,4}[- .]?\d{4}|\d{6}[- ]?[1-8]\d{6}/.test(content)) throw new Error("이메일, 연락처 또는 식별번호가 남아 있습니다. 공유 초안에서 제거해 주세요.");
  const fingerprint = (payload: ContributionPayload) => [payload.kind, payload.facts, payload.judgment, payload.conclusion, payload.questions].join("|").replace(/\s/g, "").toLowerCase();
  if (board.entries.some((other) => other.id !== id && ["pending", "published"].includes(other.status) && fingerprint(other.payload) === fingerprint(p))) throw new Error("동일한 내용의 제안이 이미 있습니다. 중복 내용을 확인해 주세요.");
  const number = entry.revisions.length + 1;
  return replace(board, { ...entry, version: entry.version + 1, status: "pending", revisions: [...entry.revisions, { number, at: new Date().toISOString(), payload: structuredClone(p), privacy: true, permission: true }], history: [...entry.history, event("submitted", actor, "검토를 요청했습니다.", number)] });
}
export function reviewContribution(board: ContributionBoard, id: string, actor: ContributionActor, decision: "publish" | "approve" | "changes" | "decline" | "retract", note: string, checks: ReviewChecks, version: number): ContributionBoard {
  const entry = selected(board, id, version);
  if (actor.role !== "reviewer" || actor.id === entry.author.id) throw new Error("작성자와 다른 검토자만 심사할 수 있습니다.");
  if (!note.trim()) throw new Error("검토 이유를 남겨 주세요.");
  if (decision === "retract" ? entry.status !== "published" : entry.status !== "pending") throw new Error("현재 상태에서는 이 검토를 처리할 수 없습니다.");
  if ((decision === "publish" || decision === "approve") && !(checks.evidence === true && checks.privacy === true && checks.duplicates === true && checks.applicability === true)) throw new Error("근거, 개인정보, 중복과 적용 범위를 모두 검토해 주세요.");
  const status = { publish: "published", approve: "approved", changes: "changes", decline: "declined", retract: "retracted" }[decision] as Contribution["status"];
  const next = { ...entry, version: entry.version + 1, status, history: [...entry.history, { ...event(status as "published" | "changes" | "declined" | "retracted", actor, note, entry.revisions.length), checks: { ...checks } }] };
  if (decision === "publish") {
    next.publication = { id: `KB-${entry.id}`, version: 1, revision: entry.revisions.length, at: new Date().toISOString() };
    next.credit = { id: `credit-${entry.id}`, status: "eligible", basis: `${next.publication.id}@1`, at: new Date().toISOString() };
  } else if (decision === "retract" && next.credit) next.credit = { ...next.credit, status: "reversed" };
  return replace(board, next);
}
export function contributionSummary(board: ContributionBoard, owner: string) {
  const entries = board.entries.filter((entry) => entry.author.id === owner);
  return { total: entries.length, pending: entries.filter((entry) => entry.status === "pending").length, published: entries.filter((entry) => entry.status === "published").length, eligible: entries.filter((entry) => entry.credit?.status === "eligible").length };
}
