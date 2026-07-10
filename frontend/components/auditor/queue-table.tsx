"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { useAuditTaskHydrated, useAuditTaskStore } from "@/lib/audit-task-store";
import { useAccountStore } from "@/lib/account-store";
import { conversations } from "@/lib/load-conversation";
import { getOccupation } from "@/lib/occupations";
import { middleTruncate } from "@/lib/utils";
import {
  formatDate,
  formatRemaining,
  TASK_STATUS_LABEL,
  taskStatusVariant,
} from "@/lib/poc-format";

export function QueueTable() {
  const hydrated = useAuditTaskHydrated();
  const tasks = useAuditTaskStore((s) => s.tasks);
  const auditorId = useAccountStore((s) => s.auditor.id);

  const open = useMemo(
    () =>
      tasks
        .filter((t) => t.status === "open" || t.status === "in_progress")
        .filter((t) => !t.pickups.some((p) => p.auditorId === auditorId))
        .filter((t) => t.pickups.length < t.capacity)
        .sort((a, b) => a.deadline - b.deadline),
    [tasks, auditorId],
  );

  if (!hydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>;
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-bold tracking-tight">참여하기</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        지금 참여할 수 있는 평가 작업 목록입니다. 카드를 선택하면 상세 내용을 확인하고 작업을 가져올 수 있습니다.
      </p>

      {open.length === 0 ? (
        <div className="mt-6 rounded-xl border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
          픽업 가능한 작업이 없습니다.
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {open.map((t) => {
            const cats = new Set<string>();
            for (const cid of t.conversationIds) {
              const c = conversations[cid];
              if (c) cats.add(c.persona.occupation);
            }
            return (
              <Link
                key={t.id}
                href={`/audit/queue/${t.id}`}
                className="flex flex-col gap-2 rounded-xl border p-4 transition hover:border-foreground hover:shadow-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    title={t.id}
                    className="min-w-0 truncate text-base font-semibold"
                  >
                    {t.label ?? middleTruncate(t.id)}
                  </span>
                  <Badge variant={taskStatusVariant(t.status)}>
                    {TASK_STATUS_LABEL[t.status]}
                  </Badge>
                </div>

                {cats.size > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {[...cats].map((c) => {
                      const occ = getOccupation(c);
                      return (
                        <span
                          key={c}
                          className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
                        >
                          {occ ? `${occ.emoji} ${occ.label}` : c}
                        </span>
                      );
                    })}
                  </div>
                )}

                <span className="text-xs text-muted-foreground">
                  {t.label && (
                    <span title={t.id} className="font-mono">{middleTruncate(t.id)} · </span>
                  )}
                  대화 {t.conversationIds.length}개 · 모집 {t.pickups.length}/
                  {t.capacity} · 마감 {formatDate(t.deadline)} (
                  {formatRemaining(t.deadline)})
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
