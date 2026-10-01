import { z } from "zod";

const text = z.string().max(6000);
const lessonSchema = z.object({
  id: z.string(), step: z.number().int().min(0).max(3), title: z.string().max(100),
  facts: text, judgment: text, conclusion: text, exceptions: text, questions: text, keywords: z.string().max(500),
});
const caseSchema = lessonSchema.omit({ step: true, questions: true }).extend({
  enabled: z.boolean(), priority: z.enum(["standard", "preferred"]), origin: z.enum(["sample", "expert"]),
});
const questionSchema = z.object({ id: z.string(), prompt: text, enabled: z.boolean(), required: z.boolean(), origin: z.enum(["sample", "expert"]), caseId: z.string().optional() });
const messageSchema = z.object({ role: z.enum(["client", "agent", "expert"]), text });
const reviewSchema = z.object({
  id: z.string(), title: text, facts: text, reason: text, caseId: z.string().optional(),
  status: z.enum(["waiting", "human", "resolved"]), messages: z.array(messageSchema).max(100),
});
export const practiceSchema = z.object({
  introduction: text, voice: z.enum(["clear", "warm", "concise"]),
  policy: z.object({ scope: text, exclusions: text, rules: text, onMissing: z.boolean(), onConflict: z.boolean(), onException: z.boolean(), available: z.boolean() }),
  lesson: lessonSchema, cases: z.array(caseSchema).max(100), questions: z.array(questionSchema).max(300), reviews: z.array(reviewSchema).max(100),
});
export type Practice = z.infer<typeof practiceSchema>;
export type Lesson = z.infer<typeof lessonSchema>;
export type KnowledgeCase = z.infer<typeof caseSchema>;
export type KnowledgeQuestion = z.infer<typeof questionSchema>;
export type Review = z.infer<typeof reviewSchema>;
export type Variation = "normal" | "missing" | "conflict" | "exception" | "request";
export const variationLabels: Record<Variation, string> = { normal: "사실이 충분할 때", missing: "사실이 부족할 때", conflict: "자료가 서로 다를 때", exception: "예외에 해당할 때", request: "고객이 직접 상담을 원할 때" };
export interface Rehearsal { id: string; query: string; variation: Variation; caseId?: string; title: string; facts: string; judgment: string; answer: string; questions: string[]; needsHuman: boolean; reason: string }

export function blankLesson(): Lesson {
  return { id: crypto.randomUUID(), step: 0, title: "", facts: "", judgment: "", conclusion: "", exceptions: "", questions: "", keywords: "" };
}

export function createPractice(): Practice {
  return {
    introduction: "필요한 사실부터 차근차근 확인하고, 판단의 이유를 함께 설명합니다.", voice: "clear",
    policy: { scope: "소상공인의 자료 준비와 기초 세무 상담", exclusions: "신고 대행, 분쟁에 대한 최종 판단은 직접 상담으로 안내합니다.", rules: "확인된 사실과 아직 모르는 사실을 구분합니다.\n근거와 예외를 함께 설명합니다.", onMissing: false, onConflict: true, onException: true, available: true },
    lesson: blankLesson(),
    cases: [
      { id: "sample-equipment", title: "업무용 장비를 구입한 고객", facts: "고객이 업무용 장비를 구입했고, 거래 일자와 영수증을 준비했습니다.", judgment: "구입 사실뿐 아니라 실제 사용 목적을 확인한 뒤 필요한 자료를 안내합니다.", conclusion: "구입 영수증, 거래 일자, 업무 사용 목적을 함께 정리해 주세요. 이 자료를 바탕으로 다음 검토를 진행할 수 있습니다.", exceptions: "개인 용도와 업무 용도가 섞여 있으면 전문가가 직접 검토합니다.", keywords: "장비, 구입, 영수증", enabled: true, priority: "standard", origin: "sample" },
      { id: "sample-opening", title: "첫 상담을 준비하는 신규 사업자", facts: "새로 사업을 시작한 고객이 첫 상담을 준비하고 있습니다.", judgment: "업종과 시작 시점, 현재 준비한 자료를 먼저 확인합니다.", conclusion: "사업 내용, 시작 예정일, 현재 준비된 서류를 정리해 주세요. 확인되지 않은 항목은 상담에서 함께 살펴보겠습니다.", exceptions: "여러 사업을 함께 운영하거나 기존 사업을 인수하는 경우 직접 상담으로 확인합니다.", keywords: "신규, 창업, 첫 상담", enabled: true, priority: "standard", origin: "sample" },
    ],
    questions: [
      { id: "sample-purpose", prompt: "장비를 어떤 업무에 사용하시나요?", enabled: true, required: true, origin: "sample" },
      { id: "sample-receipt", prompt: "구입 일자와 영수증을 확인할 수 있을까요?", enabled: true, required: true, origin: "sample", caseId: "sample-equipment" },
      { id: "sample-business", prompt: "어떤 사업을 언제 시작하셨나요?", enabled: true, required: true, origin: "sample", caseId: "sample-opening" },
    ], reviews: [],
  };
}

export function validateLesson(lesson: Lesson, step: number): string[] {
  const issues: string[] = [];
  if (!lesson.title.trim()) issues.push("사례 이름을 입력해 주세요.");
  if (!lesson.facts.trim()) issues.push("확인된 사실을 입력해 주세요.");
  if (!lesson.conclusion.trim()) issues.push("고객에게 전할 답변을 입력해 주세요.");
  if (step >= 1 && !lesson.judgment.trim()) issues.push("판단한 이유를 입력해 주세요.");
  if (step >= 2 && !lesson.keywords.trim()) issues.push("사례를 찾을 검색어를 입력해 주세요.");
  return issues;
}

/** Organizes expert-supplied fields only. No model inference or automatic training. */
export function applyLesson(practice: Practice): Practice {
  const issues = validateLesson(practice.lesson, 2);
  if (issues.length) throw new Error(issues[0]);
  const fields = practice.lesson;
  const previous = practice.cases.find((item) => item.id === fields.id);
  const entry: KnowledgeCase = { ...fields, enabled: previous?.enabled ?? true, priority: previous?.priority ?? "standard", origin: "expert" };
  const prompts = [...new Set(fields.questions.split("\n").map((line) => line.trim()).filter(Boolean))];
  const nextQuestions: KnowledgeQuestion[] = prompts.map((prompt, index) => ({ id: `${fields.id}-question-${index}`, prompt, enabled: true, required: true, origin: "expert", caseId: fields.id }));
  return practiceSchema.parse({ ...practice, lesson: { ...practice.lesson, step: 3 }, cases: [...practice.cases.filter((item) => item.id !== fields.id), entry], questions: [...practice.questions.filter((item) => item.caseId !== fields.id), ...nextQuestions] });
}

/** A transparent keyword rehearsal, not semantic RAG. Priority applies only to matches. */
export function retrieveCases(practice: Practice, query: string): KnowledgeCase[] {
  const normalized = query.toLocaleLowerCase().trim();
  if (!normalized) return [];
  return practice.cases.filter((item) => item.enabled && [item.title, item.facts, item.judgment, item.conclusion, item.keywords].every((value) => value.trim())).map((item) => ({
    item, score: [...new Set(item.keywords.split(/[,\n]+/).map((word) => word.trim().toLocaleLowerCase()).filter(Boolean))].filter((word) => normalized.includes(word)).length,
  })).filter(({ score }) => score > 0).sort((a, b) => Number(b.item.priority === "preferred") - Number(a.item.priority === "preferred") || b.score - a.score).map(({ item }) => item);
}

export function rehearse(practice: Practice, query: string, variation: Variation): Rehearsal {
  if (!query.trim()) throw new Error("고객 질문을 입력해 주세요.");
  const entry = retrieveCases(practice, query)[0];
  const result: Rehearsal = { id: crypto.randomUUID(), query: query.trim(), variation, caseId: entry?.id, title: entry?.title ?? "맞는 지식이 없는 상담", facts: entry?.facts ?? "질문에 대응하는 저장된 사실이 없습니다.", judgment: "", answer: "", questions: [], needsHuman: false, reason: "" };
  if (variation === "request") {
    return { ...result, answer: "전문가의 직접 답변을 요청할 수 있습니다. 요청 후 참여 상태를 확인해 주세요.", needsHuman: true, reason: "고객이 직접 상담을 요청했습니다." };
  }
  if (!entry) return { ...result, answer: "이 질문에 맞는 사용 중인 사례를 찾지 못했습니다. 전문가에게 확인하거나 관련 지식을 추가해 주세요.", needsHuman: true, reason: "참고할 지식이 없습니다." };
  if (variation === "missing") {
    result.questions = practice.questions.filter((item) => item.enabled && item.required && (!item.caseId || item.caseId === entry.id)).map((item) => item.prompt);
    return { ...result, facts: "사실이 부족한 상황을 선택했습니다. 저장된 사례의 사실은 아직 확인되지 않았습니다.", answer: result.questions.length ? "답변을 준비하려면 먼저 확인이 필요합니다." : "추가 확인이 필요하지만 사용 중인 필수 질문이 없습니다. 질문을 추가하거나 전문가에게 확인해 주세요.", needsHuman: practice.policy.onMissing, reason: practice.policy.onMissing ? "사실이 부족하면 직접 확인하도록 설정했습니다." : "사실을 보완한 뒤 다시 답변합니다." };
  }
  if (variation === "conflict") return { ...result, facts: "고객 진술과 제출 자료가 서로 다른 상황입니다.", answer: "자료가 서로 달라 결론을 보류합니다. 정확한 사실을 확인한 뒤 답변을 이어가겠습니다.", needsHuman: practice.policy.onConflict, reason: "서로 다른 자료를 확인해야 합니다." };
  if (variation === "exception") return { ...result, answer: entry.exceptions || "이 사례에 적용할 예외가 아직 정리되지 않았습니다. 일반 답변을 적용하기 전에 확인이 필요합니다.", needsHuman: practice.policy.onException, reason: "일반 사례의 예외를 직접 검토해야 합니다." };
  const answer = practice.voice === "concise" ? entry.conclusion : `${practice.voice === "warm" ? "차근차근 함께 살펴보겠습니다. " : ""}${entry.conclusion}\n\n판단 이유: ${entry.judgment}`;
  return { ...result, judgment: entry.judgment, answer, reason: "선택한 상황은 직접 참여 조건에 해당하지 않습니다." };
}

export function requestReview(practice: Practice, run: Rehearsal): Practice {
  const existing = practice.reviews.find((review) => review.id === run.id);
  if (existing) return existing.status === "resolved" ? updateReview(practice, run.id, (review) => ({ ...review, status: "waiting", reason: run.needsHuman ? run.reason : "고객이 직접 상담을 요청했습니다." })) : practice;
  const review: Review = { id: run.id, title: run.title, facts: run.facts, caseId: run.caseId, reason: run.needsHuman ? run.reason : "고객이 직접 상담을 요청했습니다.", status: "waiting", messages: [{ role: "client", text: run.query }, { role: "agent", text: [run.answer, ...run.questions].join("\n") }] };
  return practiceSchema.parse({ ...practice, reviews: [review, ...practice.reviews] });
}

function updateReview(practice: Practice, id: string, update: (review: Review) => Review): Practice {
  if (!practice.reviews.some((review) => review.id === id)) throw new Error("상담 요청을 찾지 못했습니다.");
  return practiceSchema.parse({ ...practice, reviews: practice.reviews.map((review) => review.id === id ? update(review) : review) });
}
export function canAgentReply(review?: Review): boolean { return review?.status !== "human"; }
export function replyAsAgent(practice: Practice, id: string, run: Rehearsal): Practice {
  return updateReview(practice, id, (review) => {
    if (!canAgentReply(review)) throw new Error("전문가가 직접 참여 중입니다. AI 답변은 잠시 멈춥니다.");
    return { ...review, facts: run.facts, caseId: run.caseId, messages: [...review.messages, { role: "client", text: run.query }, { role: "agent", text: [run.answer, ...run.questions].join("\n") }] };
  });
}
export function takeOver(practice: Practice, id: string): Practice {
  if (!practice.policy.available) throw new Error("지금은 부재중입니다. 운영 원칙에서 참여 가능 상태로 바꿔 주세요.");
  return updateReview(practice, id, (review) => ({ ...review, status: "human" }));
}
export function replyAsExpert(practice: Practice, id: string, message: string): Practice {
  if (!message.trim()) throw new Error("고객에게 전할 답변을 입력해 주세요.");
  return updateReview(practice, id, (review) => {
    if (review.status !== "human") throw new Error("직접 참여를 시작한 뒤 답변해 주세요.");
    return { ...review, messages: [...review.messages, { role: "expert", text: message.trim() }] };
  });
}
export function returnToAgent(practice: Practice, id: string): Practice {
  return updateReview(practice, id, (review) => {
    if (review.status !== "human") throw new Error("직접 참여 중인 상담만 AI에 돌려줄 수 있습니다.");
    return { ...review, status: "resolved" };
  });
}
