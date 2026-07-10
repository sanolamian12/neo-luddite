"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useAuditTaskHydrated,
  useAuditTaskStore,
} from "@/lib/audit-task-store";
import {
  formatDate,
  formatRemaining,
  TASK_STATUS_LABEL,
  taskStatusVariant,
} from "@/lib/poc-format";
import { middleTruncate } from "@/lib/utils";

export function TasksTable() {
  const hydrated = useAuditTaskHydrated();
  const tasks = useAuditTaskStore((s) => s.tasks);

  const sorted = useMemo(() => {
    return [...tasks].sort((a, b) => b.createdAt - a.createdAt);
  }, [tasks]);

  if (!hydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>;
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Task 목록</h1>
        <Button render={<Link href="/admin/tasks/new" />}>새 Task</Button>
      </div>

      <div className="rounded-xl border bg-card">
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <Th>Task ID</Th>
                <Th>라벨</Th>
                <Th className="text-right">대화 수</Th>
                <Th>모집</Th>
                <Th>등록일</Th>
                <Th>마감</Th>
                <Th>상태</Th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-muted-foreground">
                    생성된 Task 가 없습니다. 후보 풀에서 선택해 Task 를 만들어 보세요.
                  </td>
                </tr>
              ) : (
                sorted.map((t) => (
                  <tr key={t.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs">
                      <Link href={`/admin/tasks/${t.id}`} className="hover:underline">
                        {t.id}
                      </Link>
                    </td>
                    <td className="px-3 py-2 max-w-[280px] truncate">{t.label ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{t.conversationIds.length}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {t.pickups.length} / {t.capacity}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{formatDate(t.createdAt)}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatDate(t.deadline)} · {formatRemaining(t.deadline)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={taskStatusVariant(t.status)}>{TASK_STATUS_LABEL[t.status]}</Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* 모바일: 카드 리스트 */}
        {sorted.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground md:hidden">
            생성된 Task 가 없습니다. 후보 풀에서 선택해 Task 를 만들어 보세요.
          </div>
        ) : (
          <ul className="divide-y md:hidden">
            {sorted.map((t) => (
              <li key={t.id} className="flex flex-col gap-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/admin/tasks/${t.id}`} className="min-w-0 hover:underline">
                    <div className="truncate font-medium">{t.label ?? "—"}</div>
                    <span
                      title={t.id}
                      className="font-mono text-xs text-muted-foreground"
                    >
                      {middleTruncate(t.id)}
                    </span>
                  </Link>
                  <Badge variant={taskStatusVariant(t.status)}>
                    {TASK_STATUS_LABEL[t.status]}
                  </Badge>
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <div>
                    <dt className="inline">대화 수 </dt>
                    <dd className="inline text-foreground tabular-nums">
                      {t.conversationIds.length}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">모집 </dt>
                    <dd className="inline text-foreground tabular-nums">
                      {t.pickups.length} / {t.capacity}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">등록일 </dt>
                    <dd className="inline text-foreground tabular-nums">
                      {formatDate(t.createdAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">마감 </dt>
                    <dd className="inline text-foreground tabular-nums">
                      {formatDate(t.deadline)} · {formatRemaining(t.deadline)}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-medium ${className ?? ""}`}>{children}</th>;
}
