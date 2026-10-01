import { z } from "zod";

const id = z.string().min(1).max(120);
const action = z.enum(["hold", "human"]);
export const policyRuleSchema = z.object({
  version: z.literal(1), id, name: z.string().max(100), enabled: z.boolean(),
  keywords: z.array(z.string().max(100)).max(20), match: z.enum(["any", "all"]),
  fields: z.array(z.object({ id, label: z.string().max(100), question: z.string().max(1000), required: z.boolean() })).max(20),
  followUp: z.object({ maxRounds: z.number().int().min(0).max(3), scope: z.enum(["conversation", "field"]), onUnknown: z.enum(["skip", "human"]), afterLimit: action }),
  conflicts: z.object({ enabled: z.boolean(), fieldIds: z.array(id).max(20), action }),
  exceptions: z.array(z.object({ id, fieldId: id, operator: z.enum(["equals", "not_equals", "contains"]), value: z.string().max(500), action })).max(20),
});
export type PolicyRule = z.infer<typeof policyRuleSchema>;
export interface FactValue { client?: string; document?: string; unknown?: boolean }
export interface PolicyInput { query: string; facts: Record<string, FactValue>; rounds: number; asked: Record<string, number> }
export interface PolicyResult {
  ruleId?: string; status: "ready" | "ask" | "hold" | "human" | "no_rule" | "invalid";
  missing: string[]; questions: { fieldId: string; text: string }[]; conflicts: string[]; exceptions: string[];
  reason: string; trace: string[];
}
export function createPolicy(): PolicyRule {
  return { version: 1, id: crypto.randomUUID(), name: "장비 구입 상담", enabled: true, keywords: ["장비", "구입", "영수증"], match: "any",
    fields: [{ id: "purpose", label: "사용 목적", question: "장비를 어떤 용도로 사용하시나요?", required: true }, { id: "date", label: "거래 일자", question: "거래 일자를 확인할 수 있을까요?", required: true }, { id: "receipt", label: "증빙 유무", question: "구입 증빙이 있나요?", required: true }],
    followUp: { maxRounds: 1, scope: "conversation", onUnknown: "skip", afterLimit: "hold" },
    conflicts: { enabled: true, fieldIds: ["date"], action: "human" },
    exceptions: [{ id: "personal-use", fieldId: "purpose", operator: "contains", value: "개인", action: "human" }],
  };
}
export function validatePolicy(rule: PolicyRule): string[] {
  if (!policyRuleSchema.safeParse(rule).success) return ["규칙의 입력 범위와 형식을 확인해 주세요."];
  const issues: string[] = [];
  if (!rule.name.trim()) issues.push("규칙 이름을 입력해 주세요.");
  if (!rule.keywords.some((word) => word.trim())) issues.push("적용할 주제 검색어를 입력해 주세요.");
  if (!rule.fields.length || rule.fields.some((field) => !field.label.trim() || !field.question.trim())) issues.push("확인할 정보의 이름과 질문을 입력해 주세요.");
  const ids = new Set(rule.fields.map((field) => field.id));
  if (ids.size !== rule.fields.length) issues.push("확인 항목의 ID가 중복되어 있습니다.");
  if (rule.conflicts.enabled && !rule.conflicts.fieldIds.length) issues.push("자료를 비교할 항목을 선택해 주세요.");
  if (rule.conflicts.fieldIds.some((field) => !ids.has(field)) || rule.exceptions.some((item) => !ids.has(item.fieldId) || !item.value.trim())) issues.push("비교와 예외 조건의 항목 및 값을 확인해 주세요.");
  return issues;
}
const normalize = (value?: string) => value?.trim().replace(/\s+/g, " ").toLocaleLowerCase() ?? "";
export function evaluatePolicies(rules: PolicyRule[], input: PolicyInput): PolicyResult {
  const result: PolicyResult = { status: "no_rule", missing: [], questions: [], conflicts: [], exceptions: [], reason: "이 질문에 적용할 사용 중인 규칙이 없습니다. 운영 원칙에서 주제를 추가해 주세요.", trace: [] };
  const query = normalize(input.query);
  const matches = rules.filter((rule) => rule.enabled).map((rule) => {
    const words = [...new Set(rule.keywords.map(normalize).filter(Boolean))];
    const hits = words.filter((word) => query.includes(word)).length;
    return { rule, score: rule.match === "all" && hits !== words.length ? 0 : hits };
  }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score);
  const rule = matches[0]?.rule;
  if (!rule) return result;
  result.ruleId = rule.id;
  const errors = validatePolicy(rule);
  if (errors.length) return { ...result, status: "invalid", reason: errors.join(" ") };
  const value = (id: string) => input.facts[id]?.unknown ? "" : normalize(input.facts[id]?.client) || normalize(input.facts[id]?.document);
  const required = rule.fields.filter((field) => field.required);
  const missing = required.filter((field) => !value(field.id));
  result.missing = missing.map((field) => field.id);
  result.trace.push(`적용 규칙: ${rule.name}`, `필수 사실 ${required.length}개 중 ${required.length - missing.length}개 확인`);
  if (rule.conflicts.enabled) {
    result.conflicts = rule.conflicts.fieldIds.filter((id) => {
      const fact = input.facts[id];
      return fact && !fact.unknown && normalize(fact.client) && normalize(fact.document) && normalize(fact.client) !== normalize(fact.document);
    });
    result.trace.push(`고객 진술 · 제출 자료: 같은 항목 ${rule.conflicts.fieldIds.length}개 비교`);
    if (result.conflicts.length) return { ...result, status: rule.conflicts.action, reason: `자료가 다른 항목: ${rule.fields.filter((field) => result.conflicts.includes(field.id)).map((field) => field.label).join(", ")}` };
  }
  const exceptions = rule.exceptions.filter((item) => {
    const actual = value(item.fieldId), expected = normalize(item.value);
    return actual && (item.operator === "equals" ? actual === expected : item.operator === "contains" ? actual.includes(expected) : actual !== expected);
  });
  result.exceptions = exceptions.map((item) => item.id);
  if (exceptions.length) return { ...result, status: exceptions.some((item) => item.action === "human") ? "human" : "hold", reason: `설정한 예외 ${exceptions.length}개에 해당합니다. 일반 결론을 보류합니다.` };
  if (!missing.length) return { ...result, status: "ready", reason: "필수 사실이 확보됐고 설정한 충돌·예외에 해당하지 않습니다." };
  if (rule.followUp.onUnknown === "human" && missing.some((field) => input.facts[field.id]?.unknown)) return { ...result, status: "human", reason: "고객이 모르는 필수 정보는 직접 확인하도록 설정했습니다." };
  result.questions = missing.filter((field) => !input.facts[field.id]?.unknown && (rule.followUp.scope === "conversation" ? input.rounds : input.asked[field.id] ?? 0) < rule.followUp.maxRounds).map((field) => ({ fieldId: field.id, text: field.question }));
  result.trace.push(`재질문: ${rule.followUp.scope === "conversation" ? "대화 전체" : "항목별"} 최대 ${rule.followUp.maxRounds}회 · 이번 질문 ${result.questions.length}개`);
  return { ...result, status: result.questions.length ? "ask" : rule.followUp.afterLimit, reason: result.questions.length ? "부족한 사실을 먼저 확인합니다." : "재질문 한도 또는 모름 응답으로 질문을 멈춥니다. 미확인 사실은 남아 있습니다." };
}
export function recordQuestions(input: PolicyInput, result: PolicyResult): PolicyInput {
  if (!result.questions.length) return input;
  const asked = { ...input.asked };
  result.questions.forEach(({ fieldId }) => { asked[fieldId] = (asked[fieldId] ?? 0) + 1; });
  return { ...input, rounds: input.rounds + 1, asked };
}
