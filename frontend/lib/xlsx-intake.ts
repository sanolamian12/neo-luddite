import * as XLSX from "xlsx";
import { conversationSchema, type Conversation } from "./conversation-schema";

/**
 * 하차장 엑셀 intake — A열=질문, B열=Upstage 답변.
 * 각 행을 Conversation(user 질문 + assistant 답변) 으로 변환한다.
 * 답변은 문장단위로 절단되어 segments 가 된다(초기 type 은 "context" 기본값,
 * framework/citation 은 이후 작업자 검수 단계에서 부여).
 */
export interface IntakeRow {
  question: string;
  answer: string;
}

/** 워크북 ArrayBuffer → 행 목록. 헤더행(질문/답변 등)은 자동 제거. */
export function parseWorkbook(data: ArrayBuffer): IntakeRow[] {
  const wb = XLSX.read(data, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: "",
  });

  const rows: IntakeRow[] = [];
  for (const r of grid) {
    const question = String(r?.[0] ?? "").trim();
    const answer = String(r?.[1] ?? "").trim();
    if (!question && !answer) continue;
    rows.push({ question, answer });
  }
  // 헤더행 추정 제거: 첫 행이 "질문/question" & "답변/answer" 류이면 skip
  if (rows.length > 0 && isHeaderRow(rows[0])) rows.shift();
  return rows;
}

function isHeaderRow(row: IntakeRow): boolean {
  const q = row.question.toLowerCase();
  const a = row.answer.toLowerCase();
  const qHead = q === "질문" || q.includes("question") || q === "q";
  const aHead = a === "답변" || a.includes("answer") || a === "a";
  return qHead && aHead;
}

/** 한국어/영문 문장 분리 — 개행 및 종결부호 기준. 종결부호 없으면 통째 1문장. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?。？！])\s+/))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 한 행 → Conversation. 유효하지 않으면(답변 비어있음 등) null.
 * @param id  생성 대화 ID (= 레지스트리 키). 예: conv_upload_<batch>_<row>
 */
export function buildConversation(
  row: IntakeRow,
  occupation: string,
  occLabel: string,
  id: string,
): Conversation | null {
  const questionText = row.question || "(질문 없음)";
  const answerSentences = splitSentences(row.answer);
  if (answerSentences.length === 0) return null;

  const draft = {
    id,
    schemaVersion: "1.0",
    persona: { occupation, label: occLabel, businessType: "미상" },
    topic: {
      title: questionText.slice(0, 40) || "엑셀 화물",
      taxCategory: "미분류",
      caseRefs: [],
      frameworks: [],
    },
    starterQuestions: [{ id: `${id}_sq0`, text: questionText.slice(0, 200) }],
    messages: [
      {
        id: `${id}_m0`,
        role: "user",
        order: 0,
        segments: [{ id: `${id}_m0_s0`, text: questionText, type: "question" }],
      },
      {
        id: `${id}_m1`,
        role: "assistant",
        order: 1,
        segments: answerSentences.map((text, j) => ({
          id: `${id}_m1_s${j}`,
          text,
          type: "context",
        })),
      },
    ],
  };

  const parsed = conversationSchema.safeParse(draft);
  return parsed.success ? parsed.data : null;
}

/** 답변 토큰 대략 추정(문자수 기반). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}
