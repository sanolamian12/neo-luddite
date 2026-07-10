"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuditWorkHydrated, useAuditWorkStore } from "@/lib/audit-work-store";
import { useReviewStore, useReviewHydrated } from "@/lib/review-store";
import { useAuditStore } from "@/lib/audit-store";
import { useAccountStore } from "@/lib/account-store";
import { conversations } from "@/lib/load-conversation";
import { middleTruncate } from "@/lib/utils";
import {
  AUDIT_STATUS_LABEL,
  auditStatusVariant,
  formatDate,
} from "@/lib/poc-format";

export function ResultsTable() {
  const workHydrated = useAuditWorkHydrated();
  const reviewHydrated = useReviewHydrated();
  const audits = useAuditWorkStore((s) => s.audits);
  const reviews = useReviewStore((s) => s.reviews);
  const allFeedback = useAuditStore((s) => s.feedback);
  const auditorId = useAccountStore((s) => s.auditor.id);

  const list = useMemo(() => {
    return audits
      .filter(
        (a) =>
          a.auditorId === auditorId &&
          (a.status === "submitted" ||
            a.status === "reviewed" ||
            a.status === "finalized"),
      )
      .sort((a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0))
      .map((a) => {
        const review = reviews.find((r) => r.auditId === a.id);
        const conv = conversations[a.conversationId];
        const totalFb = allFeedback.filter(
          (f) => f.conversationId === a.conversationId,
        ).length;
        const accepted = review?.decisions.filter((d) => d.accepted).length ?? 0;
        const rejected = review?.decisions.filter((d) => !d.accepted).length ?? 0;
        const seen = Boolean(review?.seenByAuditorAt);
        return { audit: a, review, conv, totalFb, accepted, rejected, seen };
      });
  }, [audits, reviews, allFeedback, auditorId]);

  if (!workHydrated || !reviewHydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>;
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">완료</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            제출을 마친 작업과 검수 결과입니다. 인정·거절 내역과 이의 가능 여부를 확인할 수 있습니다.
          </p>
        </div>
        <p className="text-sm text-muted-foreground">{list.length}건</p>
      </div>

      {list.length === 0 ? (
        <div className="rounded-xl border bg-card py-12 text-center text-sm text-muted-foreground">
          아직 제출한 결과물이 없습니다.
        </div>
      ) : (
        <div className="rounded-xl border bg-card">
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <Th>Audit</Th>
                  <Th>대화</Th>
                  <Th>제출</Th>
                  <Th>검수</Th>
                  <Th className="text-right">인정/거절</Th>
                  <Th>이의 가능</Th>
                  <Th>상태</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {list.map(({ audit, review, conv, accepted, rejected, totalFb, seen }) => (
                  <tr key={audit.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs">
                      <Link
                        href={`/audit/results/${audit.id}`}
                        title={audit.id}
                        className="hover:underline"
                      >
                        {middleTruncate(audit.id)}
                      </Link>
                    </td>
                    <td className="px-3 py-2 max-w-[260px]">
                      <div className="truncate font-medium">{conv?.topic.title ?? audit.conversationId}</div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{formatDate(audit.submittedAt)}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {review?.finalizedAt ? formatDate(review.finalizedAt) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-xs">
                      {review?.status === "saved" || review?.status === "finalized" ? (
                        <span>
                          <span className="text-emerald-600">{accepted}</span>/
                          <span className="text-rose-600">{rejected}</span>
                          <span className="ml-1 text-muted-foreground">/ {totalFb}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {review?.status === "saved" ? (
                        <span className="text-amber-700">가능</span>
                      ) : review?.status === "finalized" ? (
                        <span className="text-muted-foreground">종료</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={auditStatusVariant(audit.status)}>
                        {AUDIT_STATUS_LABEL[audit.status]}
                      </Badge>
                      {audit.status === "reviewed" && !seen && (
                        <span
                          className="ml-1 inline-block size-1.5 rounded-full bg-primary align-middle"
                          aria-label="미확인"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        variant={audit.status === "reviewed" && !seen ? "default" : "outline"}
                        render={<Link href={`/audit/results/${audit.id}`} />}
                      >
                        {audit.status === "reviewed" ? "확인" : "보기"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="divide-y md:hidden">
            {list.map(({ audit, review, conv, accepted, rejected, totalFb, seen }) => (
              <li key={audit.id} className="flex flex-col gap-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {conv?.topic.title ?? audit.conversationId}
                    </div>
                    <span
                      title={audit.id}
                      className="font-mono text-xs text-muted-foreground"
                    >
                      {middleTruncate(audit.id)}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge variant={auditStatusVariant(audit.status)}>
                      {AUDIT_STATUS_LABEL[audit.status]}
                    </Badge>
                    {audit.status === "reviewed" && !seen && (
                      <span
                        className="inline-block size-1.5 rounded-full bg-primary"
                        aria-label="미확인"
                      />
                    )}
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">제출</dt>
                  <dd>{formatDate(audit.submittedAt)}</dd>
                  <dt className="text-muted-foreground">검수</dt>
                  <dd>{review?.finalizedAt ? formatDate(review.finalizedAt) : "—"}</dd>
                  <dt className="text-muted-foreground">인정/거절</dt>
                  <dd>
                    {review?.status === "saved" || review?.status === "finalized" ? (
                      <span>
                        <span className="text-emerald-600">{accepted}</span>/
                        <span className="text-rose-600">{rejected}</span>
                        <span className="ml-1 text-muted-foreground">/ {totalFb}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </dd>
                  <dt className="text-muted-foreground">이의 가능</dt>
                  <dd>
                    {review?.status === "saved" ? (
                      <span className="text-amber-700">가능</span>
                    ) : review?.status === "finalized" ? (
                      <span className="text-muted-foreground">종료</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </dd>
                </dl>
                <div className="flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant={audit.status === "reviewed" && !seen ? "default" : "outline"}
                    render={<Link href={`/audit/results/${audit.id}`} />}
                  >
                    {audit.status === "reviewed" ? "확인" : "보기"}
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
