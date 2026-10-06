import { evaluatePolicies, type PolicyInput, type PolicyResult } from "./agent-policy";
import { retrieveCases, type Practice, type Rehearsal } from "./agent-practice";

export interface PolicyRehearsal extends Rehearsal { evaluation: PolicyResult; source?: "sample" | "expert" | "community"; community?: { contributionId: string; author: string; version: number } }
/** Deterministic prototype seam: structured observations are supplied explicitly, never inferred. */
export function rehearsePolicy(practice: Practice, input: PolicyInput): PolicyRehearsal {
  if (!input.query.trim()) throw new Error("고객 질문을 입력해 주세요.");
  const evaluation = evaluatePolicies(practice.rules ?? [], input);
  const rule = practice.rules?.find((item) => item.id === evaluation.ruleId);
  const entry = retrieveCases(practice, input.query)[0];
  const facts = rule?.fields.map((field) => {
    const fact = input.facts[field.id];
    return `${field.label}: ${fact?.unknown ? "고객이 모름 · 미확인" : [fact?.client?.trim() && `고객 진술 ${fact.client.trim()}`, fact?.document?.trim() && `제출 자료 ${fact.document.trim()}`].filter(Boolean).join(" / ") || "미확인"}`;
  }).join("\n") || "적용할 기준이 없어 사실 확인을 완료하지 않았습니다.";
  const ready = evaluation.status === "ready" && !!entry;
  const reason = evaluation.status === "ready" && !entry ? "참고할 사용 중인 지식이 없습니다." : evaluation.reason;
  const answer = ready ? `${practice.voice === "warm" ? "차근차근 함께 살펴보겠습니다. " : ""}${entry.conclusion}${practice.voice === "concise" ? "" : `\n\n판단 이유: ${entry.judgment}`}` : `${reason}\n확인되지 않은 사실에 대한 일반 결론은 보류합니다.`;
  return { id: crypto.randomUUID(), query: input.query.trim(), variation: "normal", caseId: entry?.id, source: entry?.community ? "community" : entry?.origin, community: entry?.community, title: entry?.title ?? rule?.name ?? "기준 확인이 필요한 상담", facts, judgment: ready ? entry.judgment : "", answer, questions: evaluation.questions.map((item) => item.text), needsHuman: evaluation.status === "human" || evaluation.status === "no_rule" || evaluation.status === "invalid" || (evaluation.status === "ready" && !entry), reason, evaluation, policyTrace: evaluation.trace };
}
