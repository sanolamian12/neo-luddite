"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { useAuditTaskHydrated, useAuditTaskStore } from "@/lib/audit-task-store";
import { useAuditWorkHydrated, useAuditWorkStore } from "@/lib/audit-work-store";
import { conversations } from "@/lib/load-conversation";
import { getOccupation } from "@/lib/occupations";
import {
  formatDate,
  formatDateTime,
  formatRemaining,
  TASK_STATUS_LABEL,
  taskStatusVariant,
  AUDIT_STATUS_LABEL,
  auditStatusVariant,
} from "@/lib/poc-format";
import { middleTruncate } from "@/lib/utils";

export function TaskDetailView({ taskId }: { taskId: string }) {
  const taskHydrated = useAuditTaskHydrated();
  const workHydrated = useAuditWorkHydrated();
  const allTasks = useAuditTaskStore((s) => s.tasks);
  const allAudits = useAuditWorkStore((s) => s.audits);
  const task = useMemo(() => allTasks.find((t) => t.id === taskId), [allTasks, taskId]);
  const audits = useMemo(() => allAudits.filter((a) => a.taskId === taskId), [allAudits, taskId]);

  const includedConvs = useMemo(() => {
    if (!task) return [];
    return task.conversationIds.map((cid) => ({ cid, conv: conversations[cid] ?? null }));
  }, [task]);

  if (!taskHydrated || !workHydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>;
  }

  if (!task) {
    return (
      <div className="px-6 py-10">
        <h1 className="text-2xl font-bold">Task 를 찾을 수 없습니다</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          <Link className="underline" href="/admin/tasks">
            목록으로
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-muted-foreground">
            <span title={task.id}>{middleTruncate(task.id)}</span>
          </p>
          <h1 className="text-2xl font-bold tracking-tight">
            {task.label ?? "(라벨 없음)"}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant={taskStatusVariant(task.status)}>{TASK_STATUS_LABEL[task.status]}</Badge>
            <span>등록 {formatDate(task.createdAt)}</span>
            <span>·</span>
            <span>
              마감 {formatDate(task.deadline)} ({formatRemaining(task.deadline)})
            </span>
            <span>·</span>
            <span>
              모집 {task.pickups.length} / {task.capacity}
            </span>
          </div>
          {task.note && <p className="mt-2 text-sm">{task.note}</p>}
        </div>
        <Link href="/admin/tasks" className="text-sm underline">
          ← 목록
        </Link>
      </div>

      <section className="rounded-xl border bg-card">
        <header className="border-b px-4 py-2 text-sm font-semibold">픽업 / 진행 상황</header>
        {task.pickups.length === 0 && audits.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            아직 픽업한 평가자가 없습니다.
          </p>
        ) : (
          <ul className="divide-y text-sm">
            {task.pickups.map((p) => {
              const myAudits = audits.filter(
                (a) => a.auditorId === p.auditorId,
              );
              return (
                <li key={p.auditorId} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">평가자 <span title={p.auditorId}>{middleTruncate(p.auditorId)}</span></div>
                    <span className="text-xs text-muted-foreground">
                      픽업 {formatDateTime(p.pickedAt)}
                    </span>
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {myAudits.map((a) => (
                      <li
                        key={a.id}
                        className="flex items-center gap-2 text-xs text-muted-foreground"
                      >
                        <span className="font-mono" title={a.id}>{middleTruncate(a.id)}</span>
                        <span>·</span>
                        <span>{conversations[a.conversationId]?.topic.title ?? a.conversationId}</span>
                        <Badge variant={auditStatusVariant(a.status)}>
                          {AUDIT_STATUS_LABEL[a.status]}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
            {Array.from({ length: Math.max(0, task.capacity - task.pickups.length) }).map((_, i) => (
              <li key={`slot-${i}`} className="px-4 py-3 text-sm text-muted-foreground">
                (빈 슬롯)
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border bg-card">
        <header className="border-b px-4 py-2 text-sm font-semibold">포함된 대화</header>
        <ul className="divide-y text-sm">
          {includedConvs.map(({ cid, conv }) => {
            const occ = conv ? getOccupation(conv.persona.occupation) : null;
            return (
              <li key={cid} className="flex items-center gap-3 px-4 py-3">
                <span className="font-mono text-xs" title={cid}>{middleTruncate(cid)}</span>
                {occ && <Badge variant="outline">{occ.emoji} {occ.label}</Badge>}
                <span className="flex-1 truncate">{conv?.topic.title ?? "—"}</span>
                <span className="text-xs text-muted-foreground">{conv?.messages.length ?? 0} turns</span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
