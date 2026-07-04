"use client";

import type { Conversation } from "@/lib/conversation-schema";
import type { LineFeedback } from "@/lib/audit-schema";
import { getStoredConversation } from "@/lib/conversation-store";

/**
 * RAG write-path service — 검수 확정(review.finalize) 시 accepted 코멘트 C 를
 * Seam A(Python) 로 보내 KB(rag.passages)에 적재한다.
 *
 * 운영 흐름 6단계의 마지막 삽(메모리 project_operational_flow / project_rag_product_thesis):
 * 하차장→일감→문장코멘트→검사실 을 통과한 코멘트가 여기서 처음으로 RAG 로 흘러든다.
 *
 * 배선 원칙:
 *  · 질문 A / 답변 B 는 정지 스냅샷(getStoredConversation)에서 segmentId 로 해소한다.
 *    라이브가 계속 흘러도 감사가 본 그 시점의 문답으로 고정된다.
 *  · 코멘트 C 와 tags 는 line_feedback 원문(audit-store)에서 온다.
 *  · 임베딩·upsert 는 백엔드(Upstage 국산)에서만 — 컴플라이언스(마스터 §1). rag.* 는 RLS 로
 *    프론트 직접 쓰기 차단이므로 반드시 이 HTTP 경계를 지난다.
 *  · 실패는 throw — 호출부(finalize)가 잡아 검수 확정 자체는 막지 않는다(비차단).
 */

function apiBase(): string {
  const base = process.env.NEXT_PUBLIC_API_BASE;
  if (!base) {
    throw new Error(
      "NEXT_PUBLIC_API_BASE 미설정 — RAG write-path(Seam A) 비활성. " +
        "frontend/.env.local 확인(예: http://localhost:8787).",
    );
  }
  return base;
}

/** 원격 RAG(Seam A) 활성 여부 — 호출부가 배선 여부를 미리 판별. */
export const isRagWriteConfigured = Boolean(process.env.NEXT_PUBLIC_API_BASE);

/** 백엔드 schema.py `IngestFeedbackItem` 과 필드 일치(camelCase). */
export interface IngestFeedbackItem {
  feedbackId: string;
  conversationId: string;
  segmentId: string;
  question: string;
  answerSegment: string;
  comment: string;
  reviewer: string;
  /** 작성자 신원(도메인 id) — passage attribution → 정산 존속연동. */
  auditorId: string;
  tags: string[];
  occupation?: string;
  taxCategory?: string;
  caseRefs: string[];
}

export interface IngestFeedbackResult {
  ingested: { feedbackId: string; passageId: string }[];
  skipped: number;
  dbConfigured: boolean;
}

/**
 * segmentId 가 달린 세그먼트(=답변 B)와 그 직전 사용자 질문(=A)을 정지 스냅샷에서 해소.
 * 세그먼트를 못 찾으면 null(적재 대상에서 제외 — 스냅샷에 없는 문답은 태울 수 없다).
 */
function resolveBundle(
  conv: Conversation,
  segmentId: string,
): { question: string; answerSegment: string } | null {
  const idx = conv.messages.findIndex((m) =>
    m.segments.some((s) => s.id === segmentId),
  );
  if (idx === -1) return null;

  const host = conv.messages[idx];
  const seg = host.segments.find((s) => s.id === segmentId);
  const answerSegment = seg?.text ?? "";

  // 질문 A = 이 답변 직전의 사용자 메시지 텍스트. 코멘트가 사용자 세그먼트에 달렸다면
  // 그 메시지 자체가 질문이다. 앞에 사용자 메시지가 없으면 주제 제목으로 폴백.
  let question = "";
  if (host.role === "user") {
    question = host.segments.map((s) => s.text).join(" ");
    return { question, answerSegment: "" };
  }
  for (let i = idx - 1; i >= 0; i--) {
    if (conv.messages[i].role === "user") {
      question = conv.messages[i].segments.map((s) => s.text).join(" ");
      break;
    }
  }
  if (!question) question = conv.topic.title;
  return { question, answerSegment };
}

/**
 * accepted line_feedback 목록을 정지 스냅샷으로 해소해 ingest item 배열로 만든다.
 * 스냅샷이 없거나 세그먼트를 못 찾은 항목은 조용히 제외한다(적재 불가).
 */
export function buildIngestItems(feedback: LineFeedback[]): IngestFeedbackItem[] {
  const items: IngestFeedbackItem[] = [];
  const convCache = new Map<string, Conversation | undefined>();

  for (const f of feedback) {
    if (!convCache.has(f.conversationId)) {
      convCache.set(f.conversationId, getStoredConversation(f.conversationId));
    }
    const conv = convCache.get(f.conversationId);
    if (!conv) continue;

    const bundle = resolveBundle(conv, f.segmentId);
    if (!bundle) continue;

    items.push({
      feedbackId: f.id,
      conversationId: f.conversationId,
      segmentId: f.segmentId,
      question: bundle.question,
      answerSegment: bundle.answerSegment,
      comment: f.body,
      reviewer: f.reviewer,
      auditorId: f.auditorId,
      tags: f.tags,
      occupation: conv.persona.occupation,
      taxCategory: conv.topic.taxCategory,
      caseRefs: conv.topic.caseRefs ?? [],
    });
  }
  return items;
}

/** ingest item 배열을 백엔드 `/api/rag/ingest` 로 배치 전송. */
export async function ingestFeedback(
  items: IngestFeedbackItem[],
): Promise<IngestFeedbackResult> {
  const url = new URL("/api/rag/ingest", apiBase());

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
  } catch (err) {
    throw new Error(
      `RAG write-path 연결 실패(${url.origin}). 백엔드가 떠 있는지 확인: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `/api/rag/ingest ${res.status} ${res.statusText}: ${detail.slice(0, 300)}`,
    );
  }
  return (await res.json()) as IngestFeedbackResult;
}

/**
 * 편의 래퍼 — accepted 코멘트를 해소·적재하고 결과를 돌려준다.
 * 태울 항목이 없으면 네트워크를 타지 않는다(빈 결과).
 */
export async function ingestAcceptedFeedback(
  feedback: LineFeedback[],
): Promise<IngestFeedbackResult> {
  const items = buildIngestItems(feedback);
  if (items.length === 0) {
    return { ingested: [], skipped: 0, dbConfigured: true };
  }
  return ingestFeedback(items);
}

// ── 포장실 (RAG 로 실린 데이터셋 추적 + 연결끊기/재연결) ─────────────────────────
// rag.* 는 RLS 로 프론트 직접 접근 차단 → 반드시 백엔드 HTTP 경계를 지난다(마스터 §1).

/** 백엔드 schema.py `PassageInfo` 와 필드 일치. */
export interface PassageInfo {
  id: string;
  dedupeKey: string;
  content: string;
  sourceKind: string;
  conversationId?: string;
  segmentId?: string;
  feedbackId?: string;
  reviewer?: string;
  auditorId?: string;
  taxCategory?: string;
  occupation?: string;
  feedbackTags: string[];
  status: string; // 'active' | 'retired'
  createdAt: number;
  updatedAt: number;
}

/** RAG 로 실린 passage 목록(대화 귀속). conversationId 주면 그 대화만(상세). */
export async function listPassages(
  conversationId?: string,
): Promise<PassageInfo[]> {
  const url = new URL("/api/rag/passages", apiBase());
  if (conversationId) url.searchParams.set("conversationId", conversationId);
  let res: Response;
  try {
    res = await fetch(url.toString());
  } catch (err) {
    throw new Error(
      `포장실 조회 연결 실패(${url.origin}). 백엔드 기동 확인: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (!res.ok) {
    throw new Error(`/api/rag/passages ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { passages: PassageInfo[] };
  return data.passages ?? [];
}

/** 연결끊기(retired)/재연결(active) — passage status 전환(삭제 아님, 추적 보존). */
export async function retractPassages(
  passageIds: string[],
  status: "retired" | "active",
): Promise<{ updated: number; dbConfigured: boolean }> {
  const url = new URL("/api/rag/retract", apiBase());
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passageIds, status }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `/api/rag/retract ${res.status} ${res.statusText}: ${detail.slice(0, 200)}`,
    );
  }
  return (await res.json()) as { updated: number; dbConfigured: boolean };
}
