"use client";

import { useEffect, useState } from "react";
import { SCORE_CATEGORY_LABELS } from "@/lib/audit-schema";
import { useAuditHydrated, useAuditStore } from "@/lib/audit-store";
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
  const hydrated = useAuditHydrated();
  const existing = evaluations[conversationId];

  const [qualitative, setQualitative] = useState("");
  const [writing, setWriting] = useState<number | null>(null);
  const [legalAccuracy, setLegalAccuracy] = useState<number | null>(null);

  // 하이드레이션/대화 전환 시 기존 평가로 시드
  useEffect(() => {
    setQualitative(existing?.qualitative ?? "");
    setWriting(existing?.scores.writing ?? null);
    setLegalAccuracy(existing?.scores.legalAccuracy ?? null);
  }, [conversationId, hydrated, existing?.id]);

  const canSave = writing != null && legalAccuracy != null;

  const onSave = () => {
    if (writing == null || legalAccuracy == null) return;
    setSessionEval(conversationId, {
      qualitative,
      scores: { writing, legalAccuracy },
      reviewer: reviewerName,
    });
  };

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
