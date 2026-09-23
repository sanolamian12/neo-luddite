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
  isOverdueTask,
  TASK_STATUS_LABEL,
  taskStatusVariant,
} from "@/lib/poc-format";
import { middleTruncate } from "@/lib/utils";
import { LoadingBlock } from "@/components/ui/spinner";
import { ConfirmAction } from "@/components/consultation/admin-ops-parts";
import * as auditTaskService from "@/services/audit-task";

export function TasksTable() {
  const hydrated = useAuditTaskHydrated();
  const tasks = useAuditTaskStore((s) => s.tasks);

  const sorted = useMemo(() => {
    return [...tasks].sort((a, b) => b.createdAt - a.createdAt);
  }, [tasks]);

  /**
   * 마감이 지났는데 아직 닫히지 않은 일감 (§12 #3).
   * 기준은 **마감일 경과만** — 픽업·진행 중 검수가 있어도 닫는다(사용자 결정 2026-09-23).
   * 닫아도 작성 중 초안(`audits` draft)은 그대로 둔다. 닫힌 일감은 새 픽업이 안 되고,
   * 0040 `can_staff_read_conversation()` 의 조건 ②(열린 일감에 실린 대화)에서 빠진다.
   */
  const overdue = useMemo(() => sorted.filter((t) => isOverdueTask(t)), [sorted]);

  if (!hydrated) {
    return <LoadingBlock label="로딩 중…" />;
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Task 목록</h1>
        <div className="flex flex-wrap items-start gap-2">
          {overdue.length > 0 ? (
            <ConfirmAction
              label={`마감 지난 Task 닫기 (${overdue.length})`}
              confirmLabel="닫기"
              testId="tasks-close-overdue"
              warning={`마감이 지난 Task ${overdue.length}건을 모두 마감 처리합니다. 작성 중인 검수 초안은 지우지 않지만, 닫힌 Task 는 새로 픽업할 수 없고 평가자가 그 Task 로 열람하던 대화도 더는 열리지 않습니다.`}
              onConfirm={async () => {
                for (const t of overdue) {
                  await auditTaskService.forceClose(t.id);
                }
              }}
            />
          ) : null}
          <Button render={<Link href="/admin/tasks/new" />}>새 Task</Button>
        </div>
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
