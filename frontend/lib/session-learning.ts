import { applyLesson, type Practice } from "./agent-practice";
import { learningSessionSchema, sessionLessonSchema, type LearningSession, type SessionLesson } from "./session-learning-schema";

export const sampleTranscript = "[00:01] 고객: 장비를 구입했고 영수증은 있습니다.\n[00:08] 전문가: 장비를 어떤 용도로 사용하시나요?\n[00:15] 고객: 업무에도 쓰고 집에서도 사용합니다.\n[00:23] 전문가: 업무와 개인 사용 내역을 구분할 수 있나요?\n[00:31] 고객: 아직 구분해 두지 않았습니다.\n[00:40] 전문가: 지금은 결론을 정하지 않고, 영수증과 사용 내역을 정리한 뒤 함께 검토하겠습니다.";

export function importSession(input: { id?: string; title: string; kind: LearningSession["kind"]; transcript: string; permitted: boolean }): LearningSession {
  if (!input.permitted) throw new Error("이 상담을 가르치기에 사용할 동의와 권한을 확인해 주세요.");
  if (input.transcript.length > 40000) throw new Error("전사문은 40,000자 이내로 나누어 주세요.");
  const id = input.id ?? crypto.randomUUID();
  const turns = input.transcript.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    const match = line.match(/^\s*(?:\[([\d:]+)\]\s*)?(고객|전문가|AI)\s*[:：]\s*(.+)$/);
    if (!match) throw new Error(`${index + 1}번째 줄의 화자를 확인해 주세요. ‘고객:’, ‘전문가:’, ‘AI:’로 시작합니다.`);
    return { id: `${id}:${index + 1}`, speaker: match[2] === "고객" ? "client" as const : match[2] === "전문가" ? "expert" as const : "agent" as const, text: match[3], at: match[1] || `발화 ${index + 1}` };
  });
  if (!turns.some((turn) => turn.speaker === "expert") || !turns.some((turn) => turn.speaker === "client")) throw new Error("고객과 전문가의 발화가 각각 필요합니다.");
  const parsed = learningSessionSchema.safeParse({ id, title: input.title.trim(), kind: input.kind, permitted: true, createdAt: new Date().toISOString(), turns });
  if (!parsed.success) throw new Error("상담 이름과 전사문 길이를 확인해 주세요. 최대 120개 발화, 발화당 6,000자입니다.");
  return parsed.data;
}

/** Extracts speaker-labeled quotations only. No inferred reasoning or model call. */
export function proposeLesson(session: LearningSession): SessionLesson {
  const experts = session.turns.filter((turn) => turn.speaker === "expert");
  return {
    id: `lesson-${session.id}`, session, title: session.title,
    facts: session.turns.filter((turn) => turn.speaker === "client").map((turn) => turn.text).join("\n").slice(0, 6000),
    judgment: "", conclusion: experts.filter((turn) => !/[?？]$/.test(turn.text)).at(-1)?.text ?? "",
    questions: experts.filter((turn) => /[?？]$/.test(turn.text)).map((turn) => turn.text).join("\n").slice(0, 6000),
    exceptions: "", keywords: "", scope: "", applicability: "reusable", evidenceConfirmed: false,
    scenario: "", expected: "", tested: false,
  };
}

export function applySessionLesson(practice: Practice, input: SessionLesson): Practice & { learning: { sessions: LearningSession[]; draft: SessionLesson } } {
  const draft = sessionLessonSchema.parse(input);
  if (draft.applicability !== "reusable") throw new Error("이 상담에만 해당하는 내용은 재사용 지식에 반영하지 않습니다.");
  if (!draft.evidenceConfirmed || !draft.scope.trim() || !draft.tested || !draft.scenario.trim() || !draft.expected.trim()) throw new Error("원문, 적용 범위와 다른 상황의 답변을 검토해 주세요.");
  const sessions = practice.learning?.sessions ?? [];
  if (sessions.length >= 20 && !sessions.some((session) => session.id === draft.session.id)) throw new Error("저장할 수 있는 상담 원문은 20개입니다.");
  const next = applyLesson({ ...practice, lesson: { ...draft, step: 2 } });
  return {
    ...next,
    cases: next.cases.map((entry) => entry.id === draft.id ? { ...entry, sourceSessionId: draft.session.id, scope: draft.scope } : entry),
    learning: { sessions: [...sessions.filter((session) => session.id !== draft.session.id), draft.session], draft },
  };
}
