"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuditWorkHydrated, useAuditWorkStore } from "@/lib/audit-work-store";
import { useReviewStore, useReviewHydrated } from "@/lib/review-store";
import { useAuditStore } from "@/lib/audit-store";
import {
  useConversationHydrated,
  useConversationStore,
} from "@/lib/conversation-store";
import { getConversation } from "@/lib/load-conversation";
import {
  AUDIT_STATUS_LABEL,
  auditStatusVariant,
  formatDate,
} from "@/lib/poc-format";
import { middleTruncate } from "@/lib/utils";

/**
 * 평가자 이름 표기: 2명까지는 콤마, 3명 이상은 "첫 평가자 외 N명".
 */
function auditorSummary(ids: string[]): string {
  if (ids.length <= 2) return ids.join(", ");
  return `${ids[0]} 외 ${ids.length - 1}명`;
}

export function InspectionTable() {
  const workHydrated = useAuditWorkHydrated();
  const reviewHydrated = useReviewHydrated();
  const convHydrated = useConversationHydrated();
  const audits = useAuditWorkStore((s) => s.audits);
  const reviews = useReviewStore((s) => s.reviews);
  const feedback = useAuditStore((s) => s.feedback);
  // 라이브 대화(정지 스냅샷) 제목 해소를 위해 conversation 스토어를 구독한다.
  const convRecords = useConversationStore((s) => s.records);

  // 검수 화면이 대화 단위로 모든 평가자의 피드백을 함께 보여주므로,
  // 이 목록도 대화 단위로 묶는다. 대표 audit(최초 제출) 하나가 그 대화의 review 를 갖는다.
  const list = useMemo(() => {
    const groups = new Map<string, typeof audits>();
    for (const a of audits) {
      if (a.status !== "submitted" && a.status !== "reviewed" && a.status !== "finalized") continue;
      const g = groups.get(a.conversationId);
      if (g) g.push(a);
      else groups.set(a.conversationId, [a]);
    }

    return [...groups.entries()]
      .map(([conversationId, group]) => {
        const sorted = [...group].sort(
          (a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0),
        );
        const primary = sorted[0];
        const auditorIds = [...new Set(sorted.map((a) => a.auditorId))];
        const conv = getConversation(conversationId);
        const review = reviews.find((r) => r.auditId === primary.id);
        const fbCount = feedback.filter(
          (f) => f.conversationId === conversationId,
        ).length;
        const accepted = review?.decisions.filter((d) => d.accepted).length ?? 0;
        const rejected = review?.decisions.filter((d) => !d.accepted).length ?? 0;
        const submittedAt = Math.max(...sorted.map((a) => a.submittedAt ?? 0));
        return {
          conversationId,
          primary,
          auditorIds,
          conv,
          review,
          fbCount,
          accepted,
          rejected,
          submittedAt,
        };
      })
      .sort((a, b) => b.submittedAt - a.submittedAt);
    // convRecords 를 의존성에 두어 스토어 하이드레이션 시 제목을 재해소.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audits, reviews, feedback, convRecords]);

  if (!workHydrated || !reviewHydrated || !convHydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>;
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">검수 큐</h1>
        <p className="text-sm text-muted-foreground">{list.length}건</p>
      </div>

      <div className="rounded-xl border bg-card">
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <Th>Task</Th>
                <Th>대화</Th>
                <Th>평가자</Th>
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
                  <td colSpan={8} className="py-12 text-center text-muted-foreground">
                    검수할 audit 이 없습니다.
                  </td>
                </tr>
              ) : (
                list.map(({ conversationId, primary, auditorIds, conv, review, fbCount, accepted, rejected, submittedAt }) => (
                  <tr key={conversationId} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs">
                      <Link
                        href={`/admin/tasks/${primary.taskId}`}
                        title={primary.taskId}
                        className="hover:underline"
                      >
                        {middleTruncate(primary.taskId)}
                      </Link>
                    </td>
                    <td className="px-3 py-2 max-w-[280px] truncate">
                      <Link
                        href={`/admin/inspection/${primary.id}`}
                        title={conv?.topic.title ?? conversationId}
                        className="hover:underline"
                      >
                        {conv?.topic.title ?? conversationId}
                      </Link>
                    </td>
                    <td
                      className="px-3 py-2"
                      title={auditorIds.length > 2 ? auditorIds.join(", ") : undefined}
                    >
                      {auditorSummary(auditorIds)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fbCount}</td>
                    <td className="px-3 py-2 text-muted-foreground">{formatDate(submittedAt)}</td>
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
                      <Badge variant={auditStatusVariant(primary.status)}>
                        {AUDIT_STATUS_LABEL[primary.status]}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        render={<Link href={`/admin/inspection/${primary.id}`} />}
                      >
                        {primary.status === "submitted" ? "검수" : "보기"}
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* 모바일: 카드 리스트 */}
        {list.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground md:hidden">
            검수할 audit 이 없습니다.
          </div>
        ) : (
          <ul className="divide-y md:hidden">
            {list.map(({ conversationId, primary, auditorIds, conv, review, fbCount, accepted, rejected, submittedAt }) => (
              <li key={conversationId} className="flex flex-col gap-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/admin/inspection/${primary.id}`}
                    className="min-w-0 hover:underline"
                  >
                    <div className="truncate font-medium">
                      {conv?.topic.title ?? conversationId}
                    </div>
                    <span
                      title={primary.taskId}
                      className="font-mono text-xs text-muted-foreground"
                    >
                      {middleTruncate(primary.taskId)}
                    </span>
                  </Link>
                  <Badge variant={auditStatusVariant(primary.status)}>
                    {AUDIT_STATUS_LABEL[primary.status]}
                  </Badge>
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <div>
                    <dt className="inline">평가자 </dt>
                    <dd className="inline text-foreground">
                      {auditorSummary(auditorIds)}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">피드백 </dt>
                    <dd className="inline text-foreground tabular-nums">{fbCount}</dd>
                  </div>
                  <div>
                    <dt className="inline">제출일 </dt>
                    <dd className="inline text-foreground tabular-nums">
                      {formatDate(submittedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">결정 </dt>
                    <dd className="inline text-foreground tabular-nums">
                      {review ? (
                        <span>
                          <span className="text-emerald-600">{accepted}</span>
                          {" / "}
                          <span className="text-rose-600">{rejected}</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                </dl>
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" render={<Link href={`/admin/inspection/${primary.id}`} />}>
                    {primary.status === "submitted" ? "검수" : "보기"}
                  </Button>
                </div>
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
