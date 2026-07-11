"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuditWorkHydrated, useAuditWorkStore } from "@/lib/audit-work-store";
import { useAuditTaskHydrated, useAuditTaskStore } from "@/lib/audit-task-store";
import { useAuditStore, useAuditHydrated } from "@/lib/audit-store";
import { useAccountStore } from "@/lib/account-store";
import {
  useConversationHydrated,
  useConversationStore,
} from "@/lib/conversation-store";
import { getConversation } from "@/lib/load-conversation";
import { getOccupation } from "@/lib/occupations";
import { middleTruncate } from "@/lib/utils";
import {
  formatDate,
  formatRemaining,
  AUDIT_STATUS_LABEL,
  auditStatusVariant,
} from "@/lib/poc-format";

export function WorkTable() {
  const workHydrated = useAuditWorkHydrated();
  const taskHydrated = useAuditTaskHydrated();
  const convHydrated = useConversationHydrated();
  const auditorId = useAccountStore((s) => s.auditor.id);
  const allAudits = useAuditWorkStore((s) => s.audits);
  const tasks = useAuditTaskStore((s) => s.tasks);
  // 공용 검수 보드 코멘트 — 총/나의 피드백 분리 산정을 위해 구독.
  const auditHydrated = useAuditHydrated();
  const feedback = useAuditStore((s) => s.feedback);
  // 라이브 대화 스냅샷 반영을 위해 conversation 스토어를 구독한다.
  const convRecords = useConversationStore((s) => s.records);

  const drafts = useMemo(
    () =>
      allAudits
        .filter((a) => a.auditorId === auditorId && a.status === "draft")
        .sort((a, b) => b.pickedAt - a.pickedAt),
    [allAudits, auditorId],
  );

  const rows = useMemo(
    () =>
      drafts.map((a) => {
        const task = tasks.find((t) => t.id === a.taskId);
        // 정적 번들 + 라이브 대화(정지 스냅샷) 양쪽에서 해소.
        const conv = getConversation(a.conversationId);
        const occ = conv ? getOccupation(conv.persona.occupation) : null;
        // 이 대화의 코멘트를 총/나의 두 축으로 분리 산정한다(공용 검수 보드).
        // 하이드레이션 전에는 총 피드백만 캐시값으로 대체하고, 나의 피드백은 0.
        const forConv = auditHydrated
          ? feedback.filter((f) => f.conversationId === a.conversationId)
          : [];
        const totalFeedback = auditHydrated
          ? forConv.length
          : a.progress.feedbackCount;
        const myFeedback = forConv.filter((f) => f.auditorId === auditorId).length;
        // '시작' 판정은 오직 내 기여(나의 코멘트·세션평가)만 본다. 남의 코멘트는 무관.
        const started = myFeedback > 0 || a.progress.hasSessionEval;
        return { a, task, conv, occ, totalFeedback, myFeedback, started };
      }),
    // convRecords·feedback 를 의존성에 두어 스토어 하이드레이션 시 재계산.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drafts, tasks, convRecords, feedback, auditHydrated, auditorId],
  );

  if (!workHydrated || !taskHydrated || !convHydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>;
  }

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

      {drafts.length === 0 ? (
        <div className="rounded-xl border bg-card py-12 text-center text-sm text-muted-foreground">
          진행 중인 작업이 없습니다.{" "}
          <Link href="/audit/queue" className="underline">
            참여하기
          </Link>
          에서 새 작업을 가져와 보세요.
        </div>
      ) : (
        <div className="rounded-xl border bg-card">
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full table-fixed text-sm">
              {/* 대화/토픽을 좁히고(≈이전의 70%) 진행도를 총/나의 두 칼럼으로 분할. */}
              <colgroup>
                <col className="w-[10%]" />
                <col className="w-[26%]" />
                <col className="w-[9%]" />
                <col className="w-[9%]" />
                <col className="w-[13%]" />
                <col className="w-[8%]" />
                <col className="w-[8%]" />
                <col className="w-[7%]" />
                <col className="w-[92px]" />
              </colgroup>
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <Th>Audit ID</Th>
                  <Th>대화 / 토픽</Th>
                  <Th>업종</Th>
                  <Th>픽업일</Th>
                  <Th>마감</Th>
                  <Th>총 피드백</Th>
                  <Th>나의 피드백</Th>
                  <Th>상태</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ a, task, conv, occ, totalFeedback, myFeedback, started }) => (
                  <tr key={a.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs">
                      <span title={a.id}>{middleTruncate(a.id)}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        title={a.conversationId}
                        className="block truncate font-mono text-xs text-muted-foreground"
                      >
                        {middleTruncate(a.conversationId)}
                      </span>
                      <div
                        title={conv?.topic.title ?? undefined}
                        className="truncate font-medium"
                      >
                        {conv?.topic.title ?? "—"}
                      </div>
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
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">
                      {totalFeedback}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {myFeedback}
                      {a.progress.hasSessionEval && (
                        <span className="ml-1 text-xs text-brand-green">· 평가 ✓</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {started ? (
                        <Badge variant={auditStatusVariant(a.status)}>
                          {AUDIT_STATUS_LABEL[a.status]}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">시작전</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          render={
                            <Link href={`/audit/work/${encodeURIComponent(a.id)}`} />
                          }
                        >
                          {started ? "이어서" : "시작"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="divide-y md:hidden">
            {rows.map(({ a, task, conv, occ, totalFeedback, myFeedback, started }) => (
              <li key={a.id} className="flex flex-col gap-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{conv?.topic.title ?? "—"}</div>
                    <span
                      title={a.id}
                      className="font-mono text-xs text-muted-foreground"
                    >
                      {middleTruncate(a.id)}
                    </span>
                  </div>
                  {started ? (
                    <Badge variant={auditStatusVariant(a.status)}>
                      {AUDIT_STATUS_LABEL[a.status]}
                    </Badge>
                  ) : (
                    <Badge variant="secondary">시작전</Badge>
                  )}
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">대화</dt>
                  <dd title={a.conversationId} className="truncate font-mono">
                    {middleTruncate(a.conversationId)}
                  </dd>
                  <dt className="text-muted-foreground">업종</dt>
                  <dd>{occ ? `${occ.emoji} ${occ.label}` : "—"}</dd>
                  <dt className="text-muted-foreground">픽업일</dt>
                  <dd>{formatDate(a.pickedAt)}</dd>
                  <dt className="text-muted-foreground">마감</dt>
                  <dd>
                    {task
                      ? `${formatDate(task.deadline)} · ${formatRemaining(task.deadline)}`
                      : "—"}
                  </dd>
                  <dt className="text-muted-foreground">총 피드백</dt>
                  <dd className="tabular-nums">{totalFeedback}</dd>
                  <dt className="text-muted-foreground">나의 피드백</dt>
                  <dd className="tabular-nums">
                    {myFeedback}
                    {a.progress.hasSessionEval && (
                      <span className="ml-1 text-brand-green">· 평가 ✓</span>
                    )}
                  </dd>
                </dl>
                <div className="flex">
                  <Button
                    size="sm"
                    render={<Link href={`/audit/work/${encodeURIComponent(a.id)}`} />}
                  >
                    {started ? "이어서" : "시작"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

    </div>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-medium ${className ?? ""}`}>{children}</th>;
}
