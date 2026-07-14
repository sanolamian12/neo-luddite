"use client";

import { useEffect, useMemo, useState } from "react";
import { Lock } from "lucide-react";
import { SCORE_CATEGORY_LABELS } from "@/lib/audit-schema";
import {
  evaluationFor,
  useAuditHydrated,
  useAuditStore,
} from "@/lib/audit-store";
import {
  isMyAuditSubmitted,
  useAuditWorkHydrated,
  useAuditWorkStore,
} from "@/lib/audit-work-store";
import { useReviewHydrated, useReviewStore } from "@/lib/review-store";
import { isConversationFinalized } from "@/lib/review-lookup";
import { useAccountStore } from "@/lib/account-store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScoreControl } from "./score-control";

/** 세션 전체 평가 — 정성(줄글) + 정량(문장력/법률적 정확성, 1–5). */
export function SessionEvalPanel({
  conversationId,
}: {
  conversationId: string;
}) {
  const evaluations = useAuditStore((s) => s.evaluations);
  const setSessionEval = useAuditStore((s) => s.setSessionEval);
  const reviewerName = useAccountStore((s) => s.auditor.reviewerName);
  const auditorId = useAccountStore((s) => s.auditor.id);
  const hydrated = useAuditHydrated();
  const existing = evaluationFor(evaluations, conversationId, auditorId);

  // 코멘트와 같은 잠금 규칙 — 세션 평가도 일감의 일부다(제출/확정 뒤 수정 불가).
  const audits = useAuditWorkStore((s) => s.audits);
  const reviews = useReviewStore((s) => s.reviews);
  const workHydrated = useAuditWorkHydrated();
  const reviewHydrated = useReviewHydrated();
  const finalized = useMemo(
    () => isConversationFinalized(reviews, audits, conversationId),
    [reviews, audits, conversationId],
  );
  const submitted = useMemo(
    () => isMyAuditSubmitted(audits, conversationId, auditorId),
    [audits, conversationId, auditorId],
  );
  const locked = finalized || submitted;
  const lockKnown = workHydrated && reviewHydrated;

  const [qualitative, setQualitative] = useState("");
  const [writing, setWriting] = useState<number | null>(null);
  const [legalAccuracy, setLegalAccuracy] = useState<number | null>(null);

  // 하이드레이션/대화 전환 시 기존 평가로 시드
  useEffect(() => {
    setQualitative(existing?.qualitative ?? "");
    setWriting(existing?.scores.writing ?? null);
    setLegalAccuracy(existing?.scores.legalAccuracy ?? null);
  }, [conversationId, hydrated, existing?.id]);

  const canSave =
    writing != null && legalAccuracy != null && !locked && lockKnown;

  const onSave = () => {
    if (!canSave || writing == null || legalAccuracy == null) return;
    setSessionEval(conversationId, {
      qualitative,
      scores: { writing, legalAccuracy },
      reviewer: reviewerName,
      auditorId,
    });
  };

  // 잠긴 일감 — 편집기 대신 제출된 평가를 읽기 전용으로 보여 준다.
  if (locked) {
    return (
      <div className="flex flex-col gap-3 border-t pt-4">
        <h2 className="text-sm font-semibold">세션 평가</h2>
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <Lock className="mt-0.5 size-3.5 shrink-0" />
          <p>
            {finalized
              ? "검수가 확정된 대화입니다. 평가를 수정할 수 없습니다."
              : "이미 제출한 일감입니다. 평가를 수정할 수 없습니다."}
          </p>
        </div>
        {existing ? (
          <div className="rounded-lg border p-3 text-sm">
            <div className="flex gap-3 text-xs">
              <span>
                {SCORE_CATEGORY_LABELS.writing} {existing.scores.writing}/5
              </span>
              <span>
                {SCORE_CATEGORY_LABELS.legalAccuracy}{" "}
                {existing.scores.legalAccuracy}/5
              </span>
            </div>
            {existing.qualitative && (
              <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                {existing.qualitative}
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">작성된 평가가 없습니다.</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      <h2 className="text-sm font-semibold">세션 평가</h2>
      <ScoreControl
        label={SCORE_CATEGORY_LABELS.writing}
        value={writing}
        onChange={setWriting}
      />
      <ScoreControl
        label={SCORE_CATEGORY_LABELS.legalAccuracy}
        value={legalAccuracy}
        onChange={setLegalAccuracy}
      />
      <Textarea
        value={qualitative}
        onChange={(e) => setQualitative(e.target.value)}
        placeholder="세션 전체에 대한 정성 평가를 입력하세요…"
        rows={4}
      />
      <Button onClick={onSave} disabled={!canSave}>
        평가 저장
      </Button>
      {hydrated && existing && (
        <p className="text-[10px] text-muted-foreground">
          평가 저장됨 · {existing.reviewer}
        </p>
      )}
    </div>
  );
}
