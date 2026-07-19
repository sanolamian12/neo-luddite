"use client";

import { getSupabase } from "@/lib/supabase/client";
import { useAuditStore } from "@/lib/audit-store";
import { useAuditWorkStore } from "@/lib/audit-work-store";
import {
  evalContributionUnits,
  type EvalDecision,
  type SessionEvaluation,
} from "@/lib/audit-schema";
import * as ledgerService from "./ledger";
import * as ragService from "./rag";

/**
 * 정성 평가 검수 service — admin 이 세무사의 **세션 총평**을 검수한다.
 *
 * 문장 단위 검수(services/review.ts)와 나란한 두 번째 갈래다. 무엇이 다른가:
 *  · 대상: line_feedback(문장 코멘트) 이 아니라 session_evaluations(총평 + 두 점수).
 *  · 저장 위치: reviews.decisions(jsonb) 가 아니라 session_evaluations 행 자체(0015).
 *    (대화, 세무사)당 총평이 정확히 1건이라 행에 직접 다는 편이 단순하다.
 *  · 단위: 검수도 세무사 1명의 총평 1건 단위다. 문장 단위 검수가 대화 전체를 한 화면에서
 *    묶어 결정하는 것과 달리, 여기서는 같은 대화라도 세무사마다 별개 항목이 된다.
 *
 * 라이프사이클 (문장 단위와 같은 두 게이트):
 *   pending →[인정/거절 + 검수 저장]→ saved →[최종 승인]→ finalized
 *   최종 승인에서만 ledger 적립 + RAG 적재. 이후 불변.
 *
 * 기여 환산: 총평 분량 6구간 → 0–5단위(evalContributionUnits).
 */

function evalById(evaluationId: string): SessionEvaluation | null {
  return (
    useAuditStore
      .getState()
      .evaluations.find((e) => e.id === evaluationId) ?? null
  );
}

/**
 * 관리자 UPDATE 가 실제로 행을 바꿨는지 확인한다.
 *
 * RLS 가 막은 UPDATE 는 **에러가 아니라 0행 갱신**으로 조용히 통과한다. 0015 의
 * eval_admin_write 정책이 적용되지 않은 환경(마이그레이션 미적용)에서 검수가 성공한 척
 * 하는 걸 막으려면 .select() 로 돌아온 행을 세야 한다. audit-store 의 deleteFeedback 이
 * 같은 함정을 겪었다.
 */
async function updateEvalRow(
  evaluationId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { data, error } = await getSupabase()
    .from("session_evaluations")
    .update(patch)
    .eq("id", evaluationId)
    .select("id");
  if (error) throw error;
  if ((data?.length ?? 0) === 0) {
    throw new Error(
      "정성 평가를 갱신하지 못했습니다 — 관리자 권한이 없거나 마이그레이션(0015)이 적용되지 않았습니다.",
    );
  }
}

/** [인정] / [거절] — 결정만 남긴다. 저장 전이라 되돌릴 수 있다. */
export async function setDecision(
  evaluationId: string,
  decision: EvalDecision,
  decidedBy: string,
): Promise<void> {
  const current = evalById(evaluationId);
  if (!current) throw new Error(`정성 평가를 찾을 수 없습니다: ${evaluationId}`);
  if (current.reviewStatus === "finalized") {
    throw new Error("최종 승인된 정성 평가는 결정을 변경할 수 없습니다.");
  }
  const decidedAt = Date.now();
  await updateEvalRow(evaluationId, {
    decision,
    decided_at: decidedAt,
    decided_by: decidedBy,
  });
  useAuditStore
    .getState()
    ._patchEval(evaluationId, { decision, decidedAt, decidedBy });
}

/**
 * [검수 저장] — 결정을 확정 구간으로 넘긴다(세무사에게 열리고 이의 가능).
 * 결정이 없으면 거부한다 — UI 버튼도 같은 조건으로 비활성이지만 DB CHECK 까지 3중.
 */
export async function save(evaluationId: string): Promise<void> {
  const current = evalById(evaluationId);
  if (!current) throw new Error(`정성 평가를 찾을 수 없습니다: ${evaluationId}`);
  if (current.reviewStatus === "finalized") {
    throw new Error("최종 승인된 정성 평가는 다시 저장할 수 없습니다.");
  }
  if (!current.decision) {
    throw new Error("인정 또는 거절을 먼저 선택하세요.");
  }
  await updateEvalRow(evaluationId, { review_status: "saved" });
  useAuditStore.getState()._patchEval(evaluationId, { reviewStatus: "saved" });
}

/**
 * [최종 승인] — saved 를 확정한다. **이 게이트에서만** ledger 적립 + RAG 적재.
 *
 * 적재는 인정된 총평만 대상이다(거절은 기여 0, RAG 에도 싣지 않는다).
 * RAG 호출은 비차단 — 백엔드 장애가 최종 승인을 되돌리지 않는다(적재는 멱등이라 재시도 안전).
 */
export async function finalize(evaluationId: string): Promise<void> {
  const current = evalById(evaluationId);
  if (!current) throw new Error(`정성 평가를 찾을 수 없습니다: ${evaluationId}`);
  if (current.reviewStatus === "finalized") return; // 멱등
  if (current.reviewStatus !== "saved") {
    throw new Error("먼저 검수를 저장한 뒤 최종 승인할 수 있습니다.");
  }

  const now = Date.now();
  await updateEvalRow(evaluationId, { review_status: "finalized" });
  useAuditStore
    .getState()
    ._patchEval(evaluationId, { reviewStatus: "finalized" });

  const accepted = current.decision === "accepted";
  const units = accepted ? evalContributionUnits(current.qualitative) : 0;

  // 기여 적립 — 총평 작성자에게 귀속.
  await ledgerService.recordSessionEvalOutcome({
    auditorId: current.auditorId,
    evaluationId: current.id,
    conversationId: current.conversationId,
    units,
    accepted,
    timestamp: now,
  });

  if (!accepted) return;

  try {
    const res = await ragService.ingestSessionEvals([current]);
    if (res.skipped > 0) {
      console.warn(
        `[rag] KB 미설정으로 정성 평가 ${res.skipped}건 적재 건너뜀(최종 승인은 완료).`,
      );
    }
  } catch (err) {
    console.warn("[rag] 정성 평가 KB 적재 실패(최종 승인은 완료됨):", err);
  }
}

/** 정성 평가가 걸린 대화의 Task id — 목록의 Task 컬럼. 없으면 null. */
export function taskIdFor(
  conversationId: string,
  auditorId: string,
): string | null {
  const audits = useAuditWorkStore.getState().audits;
  const mine = audits.find(
    (a) => a.conversationId === conversationId && a.auditorId === auditorId,
  );
  return mine?.taskId ?? null;
}
