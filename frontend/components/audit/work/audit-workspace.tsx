"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { getConversation } from "@/lib/load-conversation";
import { evaluationFor, useAuditStore, useAuditHydrated } from "@/lib/audit-store";
import { useAuditWorkStore, useAuditWorkHydrated } from "@/lib/audit-work-store";
import { AuditTranscript } from "../audit-transcript";
import { WorkQueueStrip } from "./work-queue-strip";
import { WorkInspector } from "./work-inspector";
import { WorkTopbar } from "./work-topbar";
import { useAccountStore } from "@/lib/account-store";
import * as auditService from "@/services/audit";

/**
 * Audit 작업 워크스페이스 — auditId 단위 3-pane.
 * 좌: 내 다른 audit 큐 스트립 / 중: 전사 / 우: 인스펙터(피드백·평가·제출 탭).
 */
export function AuditWorkspace({ auditId }: { auditId: string }) {
  const workHydrated = useAuditWorkHydrated();
  const auditHydrated = useAuditHydrated();
  const allAudits = useAuditWorkStore((s) => s.audits);
  const feedback = useAuditStore((s) => s.feedback);
  const evaluations = useAuditStore((s) => s.evaluations);
  const auditorId = useAccountStore((s) => s.auditor.id);
  const selectSegment = useAuditStore((s) => s.selectSegment);

  const audit = useMemo(
    () => allAudits.find((a) => a.id === auditId),
    [allAudits, auditId],
  );
  const conv = audit ? getConversation(audit.conversationId) : null;

  // audit 전환 시 선택 초기화
  useEffect(() => {
    selectSegment(null);
  }, [auditId, selectSegment]);

  // 라인 피드백 / 세션 평가 변경 시 Audit progress 동기화 (draft 상태일 때만)
  useEffect(() => {
    if (!audit || !conv || audit.status !== "draft") return;
    if (!workHydrated || !auditHydrated) return;
    const feedbackCount = feedback.filter(
      (f) => f.conversationId === audit.conversationId,
    ).length;
    const hasSessionEval = Boolean(
      evaluationFor(evaluations, audit.conversationId, audit.auditorId),
    );
    const totalSegments = conv.messages
      .filter((m) => m.role === "assistant")
      .reduce((acc, m) => acc + m.segments.length, 0);
    if (
      audit.progress.feedbackCount === feedbackCount &&
      audit.progress.hasSessionEval === hasSessionEval &&
      audit.progress.totalSegments === totalSegments
    )
      return;
    void auditService.patchProgress(audit.id, {
      feedbackCount,
      hasSessionEval,
      totalSegments,
    });
  }, [audit, conv, feedback, evaluations, workHydrated, auditHydrated]);

  if (!workHydrated) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        로딩 중…
      </div>
    );
  }

  if (!audit) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2">
        <p className="text-sm">Audit 을 찾을 수 없습니다.</p>
        <Link href="/audit/work" className="text-sm underline">
          진행중 목록으로
        </Link>
      </div>
    );
  }

  if (!conv) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        대화 데이터를 찾을 수 없습니다: {audit.conversationId}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <WorkTopbar audit={audit} conversation={conv} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <WorkQueueStrip currentAuditId={auditId} auditorId={auditorId} />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <AuditTranscript conversationId={audit.conversationId} conversation={conv} />
        </main>
        <WorkInspector audit={audit} conversation={conv} />
      </div>
    </div>
  );
}
