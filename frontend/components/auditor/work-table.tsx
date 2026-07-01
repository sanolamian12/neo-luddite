"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuditWorkHydrated, useAuditWorkStore } from "@/lib/audit-work-store";
import { useAuditTaskHydrated, useAuditTaskStore } from "@/lib/audit-task-store";
import { useAccountStore } from "@/lib/account-store";
import { conversations } from "@/lib/load-conversation";
import { getOccupation } from "@/lib/occupations";
import * as auditTaskService from "@/services/audit-task";
import {
  formatDate,
  formatRemaining,
  AUDIT_STATUS_LABEL,
  auditStatusVariant,
} from "@/lib/poc-format";

export function WorkTable() {
  const workHydrated = useAuditWorkHydrated();
  const taskHydrated = useAuditTaskHydrated();
  const auditorId = useAccountStore((s) => s.auditor.id);
  const allAudits = useAuditWorkStore((s) => s.audits);
  const tasks = useAuditTaskStore((s) => s.tasks);
  const [error, setError] = useState<string | null>(null);

  const drafts = useMemo(
    () =>
      allAudits
        .filter((a) => a.auditorId === auditorId && a.status === "draft")
        .sort((a, b) => b.pickedAt - a.pickedAt),
    [allAudits, auditorId],
  );

  if (!workHydrated || !taskHydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>;
  }

  const onCancel = async (taskId: string) => {
    setError(null);
    try {
      await auditTaskService.releasePickup(taskId, auditorId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">진행중</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            내가 가져와 평가를 진행하고 있는 작업입니다. 이어서 작성하거나 제출할 수 있습니다.
          </p>
        </div>
        <p className="text-sm text-muted-foreground">진행 중 {drafts.length}건</p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <Th>Audit ID</Th>
              <Th>대화 / 토픽</Th>
              <Th>업종</Th>
              <Th>픽업일</Th>
              <Th>마감</Th>
              <Th>진행도</Th>
              <Th>상태</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {drafts.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-muted-foreground">
                  진행 중인 작업이 없습니다.{" "}
                  <Link href="/audit/queue" className="underline">
                    참여하기
                  </Link>
                  에서 새 작업을 가져와 보세요.
                </td>
              </tr>
            ) : (
              drafts.map((a) => {
                const task = tasks.find((t) => t.id === a.taskId);
                const conv = conversations[a.conversationId];
                const occ = conv ? getOccupation(conv.persona.occupation) : null;
                return (
                  <tr key={a.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs">{a.id}</td>
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {a.conversationId}
                      </span>
                      <div className="font-medium">{conv?.topic.title ?? "—"}</div>
                    </td>
                    <td className="px-3 py-2">
                      {occ && (
                        <Badge variant="outline">
                          {occ.emoji} {occ.label}
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{formatDate(a.pickedAt)}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {task ? `${formatDate(task.deadline)} · ${formatRemaining(task.deadline)}` : "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {a.progress.feedbackCount} 피드백
                      {a.progress.hasSessionEval && (
                        <span className="ml-1 text-xs text-brand-green">· 평가 ✓</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={auditStatusVariant(a.status)}>
                        {AUDIT_STATUS_LABEL[a.status]}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          render={
                            <Link href={`/audit/work/${encodeURIComponent(a.id)}`} />
                          }
                        >
                          이어서
                        </Button>
                        {a.progress.feedbackCount === 0 && !a.progress.hasSessionEval && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onCancel(a.taskId)}
                          >
                            취소
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
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
