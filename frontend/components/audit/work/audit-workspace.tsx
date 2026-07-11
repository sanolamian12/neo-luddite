"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { cn, middleTruncate } from "@/lib/utils";
import { getConversation } from "@/lib/load-conversation";
import { evaluationFor, useAuditStore, useAuditHydrated } from "@/lib/audit-store";
import { useAuditWorkStore, useAuditWorkHydrated } from "@/lib/audit-work-store";
import {
  useConversationHydrated,
  useConversationStore,
} from "@/lib/conversation-store";
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
  const convHydrated = useConversationHydrated();
  // 라이브 대화 스냅샷 반영을 위해 conversation 스토어를 구독한다(재렌더 트리거).
  useConversationStore((s) => s.records);
  const allAudits = useAuditWorkStore((s) => s.audits);
  const feedback = useAuditStore((s) => s.feedback);
  const evaluations = useAuditStore((s) => s.evaluations);
  const auditorId = useAccountStore((s) => s.auditor.id);
  const selectSegment = useAuditStore((s) => s.selectSegment);
  // 모바일(<md)에서는 3-pane 을 동시에 못 띄우므로 탭으로 전환.
  const [mobileTab, setMobileTab] = useState<"queue" | "transcript" | "inspector">(
    "transcript",
  );

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

  if (!workHydrated || !convHydrated) {
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
        <span title={audit.conversationId}>
          대화 데이터를 찾을 수 없습니다: {middleTruncate(audit.conversationId)}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <WorkTopbar audit={audit} conversation={conv} />
      {/* 모바일 탭 전환기 — 데스크톱은 3-pane 동시 표시 */}
      <div className="flex shrink-0 border-b md:hidden">
        {(
          [
            ["queue", "큐"],
            ["transcript", "전사"],
            ["inspector", "검수"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setMobileTab(id)}
            className={cn(
              "flex-1 px-3 py-2 text-sm font-medium transition",
              mobileTab === id
                ? "border-b-2 border-foreground text-foreground"
                : "text-muted-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <WorkQueueStrip
          currentAuditId={auditId}
          auditorId={auditorId}
          mobileShow={mobileTab === "queue"}
        />
        <main
          className={cn(
            "min-w-0 flex-1 overflow-y-auto md:block",
            mobileTab === "transcript" ? "block" : "hidden",
          )}
        >
          <AuditTranscript conversationId={audit.conversationId} conversation={conv} />
        </main>
        <WorkInspector
          audit={audit}
          conversation={conv}
          mobileShow={mobileTab === "inspector"}
        />
      </div>
    </div>
  );
}
