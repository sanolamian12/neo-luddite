"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuditTaskHydrated, useAuditTaskStore } from "@/lib/audit-task-store";
import { useAccountHydrated, useAccountStore } from "@/lib/account-store";
import { conversations } from "@/lib/load-conversation";
import { getOccupation } from "@/lib/occupations";
import { middleTruncate } from "@/lib/utils";
import * as auditTaskService from "@/services/audit-task";
import {
  formatDate,
  formatRemaining,
  TASK_STATUS_LABEL,
  taskStatusVariant,
} from "@/lib/poc-format";

export function QueueDetailView({ taskId }: { taskId: string }) {
  const router = useRouter();
  const taskHydrated = useAuditTaskHydrated();
  const accountHydrated = useAccountHydrated();
  const task = useAuditTaskStore((s) => s.tasks.find((t) => t.id === taskId));
  const auditorId = useAccountStore((s) => s.auditor.id);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alreadyPicked = useMemo(
    () => task?.pickups.some((p) => p.auditorId === auditorId) ?? false,
    [task, auditorId],
  );

  if (!taskHydrated || !accountHydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>;
  }

  if (!task) {
    return (
      <div className="px-6 py-10">
        <h1 className="text-2xl font-bold">Task 를 찾을 수 없습니다</h1>
        <p className="mt-2 text-sm">
          <Link className="underline" href="/audit/queue">
            ← 큐로 돌아가기
          </Link>
        </p>
      </div>
    );
  }

  const isFull = task.pickups.length >= task.capacity;
  const isClosed = task.status === "closed";
  const canPick = !alreadyPicked && !isFull && !isClosed;

  const onPick = async () => {
    setError(null);
    setPicking(true);
    try {
      await auditTaskService.pickup(task.id, auditorId);
      router.push("/audit/work");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPicking(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 px-6 py-6 max-w-4xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p title={task.id} className="font-mono text-xs text-muted-foreground">{middleTruncate(task.id)}</p>
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
        <Link href="/audit/queue" className="text-sm underline">
          ← 큐
        </Link>
      </div>

      <section className="rounded-xl border bg-card">
        <header className="border-b px-4 py-2 text-sm font-semibold">
          포함된 대화 ({task.conversationIds.length})
        </header>
        <ul className="divide-y text-sm">
          {task.conversationIds.map((cid) => {
            const c = conversations[cid];
            const occ = c ? getOccupation(c.persona.occupation) : null;
            return (
              <li key={cid} className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span title={cid} className="font-mono text-xs">{middleTruncate(cid)}</span>
                  {occ && (
                    <Badge variant="outline">
                      {occ.emoji} {occ.label}
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {c?.messages.length ?? 0} turns
                  </span>
                </div>
                <p className="mt-1 font-medium">{c?.topic.title ?? "—"}</p>
                {c?.starterQuestions[0] && (
                  <p className="text-xs text-muted-foreground">
                    “{c.starterQuestions[0].text}”
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {alreadyPicked && (
          <span className="text-sm text-muted-foreground">이미 픽업한 작업입니다.</span>
        )}
        {isFull && !alreadyPicked && (
          <span className="text-sm text-muted-foreground">모집 정원이 마감되었습니다.</span>
        )}
        <Button variant="ghost" render={<Link href="/audit/queue" />}>
          닫기
        </Button>
        <Button onClick={onPick} disabled={!canPick || picking}>
          {alreadyPicked
            ? "이어서 작업"
            : picking
              ? "픽업 중…"
              : "픽업하기"}
        </Button>
      </div>
    </div>
  );
}
