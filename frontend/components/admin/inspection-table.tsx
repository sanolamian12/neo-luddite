"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuditWorkHydrated, useAuditWorkStore } from "@/lib/audit-work-store";
import { useAuditTaskStore } from "@/lib/audit-task-store";
import { useReviewStore, useReviewHydrated } from "@/lib/review-store";
import { useAuditStore } from "@/lib/audit-store";
import { conversations } from "@/lib/load-conversation";
import {
  AUDIT_STATUS_LABEL,
  auditStatusVariant,
  formatDate,
} from "@/lib/poc-format";

export function InspectionTable() {
  const workHydrated = useAuditWorkHydrated();
  const reviewHydrated = useReviewHydrated();
  const audits = useAuditWorkStore((s) => s.audits);
  const tasks = useAuditTaskStore((s) => s.tasks);
  const reviews = useReviewStore((s) => s.reviews);
  const feedback = useAuditStore((s) => s.feedback);

  const list = useMemo(() => {
    return audits
      .filter((a) => a.status === "submitted" || a.status === "reviewed" || a.status === "finalized")
      .sort((a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0))
      .map((a) => {
        const task = tasks.find((t) => t.id === a.taskId);
        const conv = conversations[a.conversationId];
        const review = reviews.find((r) => r.auditId === a.id);
        const fbCount = feedback.filter(
          (f) => f.conversationId === a.conversationId,
        ).length;
        const accepted = review?.decisions.filter((d) => d.accepted).length ?? 0;
        const rejected = review?.decisions.filter((d) => !d.accepted).length ?? 0;
        return { audit: a, task, conv, review, fbCount, accepted, rejected };
      });
  }, [audits, tasks, reviews, feedback]);

  if (!workHydrated || !reviewHydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>;
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">검수 큐</h1>
        <p className="text-sm text-muted-foreground">{list.length}건</p>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <Th>Audit ID</Th>
              <Th>평가자</Th>
              <Th>Task</Th>
              <Th>대화</Th>
              <Th className="text-right">피드백</Th>
              <Th>제출일</Th>
              <Th>결정</Th>
              <Th>상태</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-12 text-center text-muted-foreground">
                  검수할 audit 이 없습니다.
                </td>
              </tr>
            ) : (
              list.map(({ audit, task, conv, review, fbCount, accepted, rejected }) => (
                <tr key={audit.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link href={`/admin/inspection/${audit.id}`} className="hover:underline">
                      {audit.id}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{audit.auditorId}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link href={`/admin/tasks/${audit.taskId}`} className="hover:underline">
                      {task?.id ?? audit.taskId}
                    </Link>
                  </td>
                  <td className="px-3 py-2 max-w-[260px] truncate">{conv?.topic.title ?? audit.conversationId}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fbCount}</td>
                  <td className="px-3 py-2 text-muted-foreground">{formatDate(audit.submittedAt)}</td>
                  <td className="px-3 py-2 text-xs">
                    {review ? (
                      <span>
                        <span className="text-emerald-600">{accepted}</span>
                        {" / "}
                        <span className="text-rose-600">{rejected}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={auditStatusVariant(audit.status)}>{AUDIT_STATUS_LABEL[audit.status]}</Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      size="sm"
                      render={<Link href={`/admin/inspection/${audit.id}`} />}
                    >
                      {audit.status === "submitted" ? "검수" : "보기"}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-medium ${className ?? ""}`}>{children}</th>;
}
