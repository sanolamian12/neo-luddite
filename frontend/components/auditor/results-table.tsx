"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  compareText,
  nextSort,
  FilterChips,
  SortableTh,
  type SortState,
} from "@/components/ui/sortable-th";
import { useAuditWorkHydrated, useAuditWorkStore } from "@/lib/audit-work-store";
import { useReviewStore, useReviewHydrated } from "@/lib/review-store";
import { reviewForAudit } from "@/lib/review-lookup";
import { useAuditStore } from "@/lib/audit-store";
import { useAccountStore } from "@/lib/account-store";
import {
  useConversationHydrated,
  useConversationStore,
} from "@/lib/conversation-store";
import { getConversation } from "@/lib/load-conversation";
import { middleTruncate } from "@/lib/utils";
import {
  AUDIT_STATUS_LABEL,
  auditStatusVariant,
  formatDate,
} from "@/lib/poc-format";

type StatusFilter = "all" | "submitted" | "reviewed" | "finalized";
type SortKey = "submittedAt" | "conversation" | "finalizedAt";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "submitted", label: AUDIT_STATUS_LABEL.submitted },
  { value: "reviewed", label: AUDIT_STATUS_LABEL.reviewed },
  { value: "finalized", label: AUDIT_STATUS_LABEL.finalized },
];

export function ResultsTable() {
  const workHydrated = useAuditWorkHydrated();
  const reviewHydrated = useReviewHydrated();
  const convHydrated = useConversationHydrated();
  const audits = useAuditWorkStore((s) => s.audits);
  const reviews = useReviewStore((s) => s.reviews);
  const allFeedback = useAuditStore((s) => s.feedback);
  const auditorId = useAccountStore((s) => s.auditor.id);
  // 라이브 대화 스냅샷 반영을 위해 conversation 스토어를 구독한다.
  const convRecords = useConversationStore((s) => s.records);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  // 기본 정렬은 최신 제출순. 헤더 클릭 시 해당 열의 오름/내림으로 전환.
  const [sort, setSort] = useState<SortState<SortKey>>({
    key: "submittedAt",
    dir: "desc",
  });

  const rows = useMemo(() => {
    return audits
      .filter(
        (a) =>
          a.auditorId === auditorId &&
          (a.status === "submitted" ||
            a.status === "reviewed" ||
            a.status === "finalized"),
      )
      .map((a) => {
        const review = reviewForAudit(reviews, audits, a);
        const conv = getConversation(a.conversationId);
        const totalFb = allFeedback.filter(
          (f) => f.conversationId === a.conversationId,
        ).length;
        const accepted = review?.decisions.filter((d) => d.accepted).length ?? 0;
        const rejected = review?.decisions.filter((d) => !d.accepted).length ?? 0;
        const seen = Boolean(review?.seenByAuditors[auditorId]);
        return {
          audit: a,
          review,
          conv,
          title: conv?.topic.title ?? a.conversationId,
          totalFb,
          accepted,
          rejected,
          seen,
        };
      });
    // convRecords 를 의존성에 두어 스토어 하이드레이션 시 재계산.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audits, reviews, allFeedback, auditorId, convRecords]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: rows.length };
    for (const r of rows) {
      counts[r.audit.status] = (counts[r.audit.status] ?? 0) + 1;
    }
    return counts;
  }, [rows]);

  const list = useMemo(() => {
    const filtered =
      statusFilter === "all"
        ? rows
        : rows.filter((r) => r.audit.status === statusFilter);

    const factor = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sort.key) {
        case "conversation":
          return factor * compareText(a.title, b.title);
        case "finalizedAt":
          // 아직 확정 전(—)인 건은 항상 뒤로 보낸다.
          if (!a.review?.finalizedAt && !b.review?.finalizedAt) return 0;
          if (!a.review?.finalizedAt) return 1;
          if (!b.review?.finalizedAt) return -1;
          return factor * (a.review.finalizedAt - b.review.finalizedAt);
        default:
          return factor * ((a.audit.submittedAt ?? 0) - (b.audit.submittedAt ?? 0));
      }
    });
  }, [rows, statusFilter, sort]);

  const toggleSort = (key: SortKey) => setSort((prev) => nextSort(prev, key));

  if (!workHydrated || !reviewHydrated || !convHydrated) {
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
        <p className="text-sm text-muted-foreground">
          {statusFilter === "all"
            ? `${list.length}건`
            : `${list.length} / ${rows.length}건`}
        </p>
      </div>

      <FilterChips
        options={STATUS_FILTERS}
        value={statusFilter}
        onChange={setStatusFilter}
        counts={statusCounts}
      />

      {list.length === 0 ? (
        <div className="rounded-xl border bg-card py-12 text-center text-sm text-muted-foreground">
          {rows.length === 0
            ? "아직 제출한 결과물이 없습니다."
            : "해당 상태의 결과물이 없습니다."}
        </div>
      ) : (
        <div className="rounded-xl border bg-card">
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <Th>Audit</Th>
                  <SortableTh
                    label="대화"
                    sortKey="conversation"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  <SortableTh
                    label="제출"
                    sortKey="submittedAt"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  <SortableTh
                    label="검수 확정"
                    sortKey="finalizedAt"
                    sort={sort}
                    onSort={toggleSort}
                  />
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
                  <dt className="text-muted-foreground">검수 확정</dt>
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
