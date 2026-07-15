"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  compareText,
  nextSort,
  FilterChips,
  SortableTh,
  type SortState,
} from "@/components/ui/sortable-th";
import { Button } from "@/components/ui/button";
import * as reviewService from "@/services/review";
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
import { cn, middleTruncate } from "@/lib/utils";

/**
 * 평가자 이름 표기: 2명까지는 콤마, 3명 이상은 "첫 평가자 외 N명".
 */
function auditorSummary(ids: string[]): string {
  if (ids.length <= 2) return ids.join(", ");
  return `${ids[0]} 외 ${ids.length - 1}명`;
}

type StatusFilter = "all" | "submitted" | "reviewed" | "finalized";
type SortKey = "submittedAt" | "task" | "conversation" | "auditor";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "submitted", label: AUDIT_STATUS_LABEL.submitted },
  { value: "reviewed", label: AUDIT_STATUS_LABEL.reviewed },
  { value: "finalized", label: AUDIT_STATUS_LABEL.finalized },
];

function RowCheckbox({
  checked,
  disabled,
  onChange,
  label,
  indeterminate,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
  indeterminate?: boolean;
}) {
  return (
    <input
      type="checkbox"
      className="size-4 accent-primary disabled:opacity-30"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      ref={(el) => {
        if (el) el.indeterminate = Boolean(indeterminate) && !checked;
      }}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
    />
  );
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

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkDone, setBulkDone] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  // 기본 정렬은 최신 제출순. 헤더 클릭 시 해당 열의 오름/내림으로 전환.
  const [sort, setSort] = useState<SortState<SortKey>>({
    key: "submittedAt",
    dir: "desc",
  });

  // 검수 화면이 대화 단위로 모든 평가자의 피드백을 함께 보여주므로,
  // 이 목록도 대화 단위로 묶는다. 대표 audit(최초 제출) 하나가 그 대화의 review 를 갖는다.
  const groups = useMemo(() => {
    const groups = new Map<string, typeof audits>();
    for (const a of audits) {
      if (a.status !== "submitted" && a.status !== "reviewed" && a.status !== "finalized") continue;
      const g = groups.get(a.conversationId);
      if (g) g.push(a);
      else groups.set(a.conversationId, [a]);
    }

    return [...groups.entries()]
      .map(([conversationId, group]) => {
        // 제출 시각 오름차순 — 미제출(submittedAt=null)은 맨 뒤로. 대표/표기 순서의 기준.
        const bySubmit = [...group].sort(
          (a, b) => (a.submittedAt ?? Infinity) - (b.submittedAt ?? Infinity),
        );
        // review 는 대화의 대표 audit 하나에만 붙는다 — 형제 중 누구에게 붙었든 찾는다.
        // (단순 primary.id 조회의 함정: 0014 로 '기여했지만 미제출'인 공동 평가자 audit 이
        //  finalized(submittedAt=null)로 바뀌면 최초제출 정렬의 1번이 그 미제출 audit 으로
        //  뒤바뀌어, review 를 못 찾고 결정 컬럼이 '—' 로 비어 보이던 버그를 막는다.)
        const review = reviews.find((r) => group.some((a) => a.id === r.auditId));
        // 대표 audit: review 보유자 우선, 없으면 실제로 제출된 것 중 최초.
        const primary =
          (review && group.find((a) => a.id === review.auditId)) ?? bySubmit[0];
        const auditorIds = [...new Set(bySubmit.map((a) => a.auditorId))];
        const conv = getConversation(conversationId);
        const fbCount = feedback.filter(
          (f) => f.conversationId === conversationId,
        ).length;
        const accepted = review?.decisions.filter((d) => d.accepted).length ?? 0;
        const rejected = review?.decisions.filter((d) => !d.accepted).length ?? 0;
        const submittedAt = Math.max(...group.map((a) => a.submittedAt ?? 0));
        return {
          conversationId,
          primary,
          auditorIds,
          conv,
          title: conv?.topic.title ?? conversationId,
          review,
          fbCount,
          accepted,
          rejected,
          submittedAt,
        };
      });
    // convRecords 를 의존성에 두어 스토어 하이드레이션 시 제목을 재해소.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audits, reviews, feedback, convRecords]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: groups.length };
    for (const g of groups) {
      counts[g.primary.status] = (counts[g.primary.status] ?? 0) + 1;
    }
    return counts;
  }, [groups]);

  // 상태 필터 → 정렬. 가나다·abc 는 ko 로케일 기준(한글 먼저, 영문·숫자 뒤).
  const list = useMemo(() => {
    const filtered =
      statusFilter === "all"
        ? groups
        : groups.filter((g) => g.primary.status === statusFilter);

    const factor = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sort.key) {
        case "task":
          return factor * compareText(a.primary.taskId, b.primary.taskId);
        case "conversation":
          return factor * compareText(a.title, b.title);
        case "auditor":
          // 표기와 같은 기준(첫 평가자)으로 정렬한다.
          return (
            factor * compareText(a.auditorIds[0] ?? "", b.auditorIds[0] ?? "")
          );
        default:
          return factor * (a.submittedAt - b.submittedAt);
      }
    });
  }, [groups, statusFilter, sort]);

  const toggleSort = (key: SortKey) => setSort((prev) => nextSort(prev, key));

  // 일괄 최종 승인 대상 = 검수 저장(saved)까지 끝난 건. 그 외(미검수·이미 확정)는 선택 불가.
  const finalizable = useMemo(
    () => list.filter((g) => g.review?.status === "saved"),
    [list],
  );
  const finalizableIds = useMemo(
    () => new Set(finalizable.map((g) => g.conversationId)),
    [finalizable],
  );
  // 목록이 갱신되면(=확정된 건이 빠지면) 선택도 유효한 것만 남긴다.
  const selectedIds = useMemo(
    () => [...selected].filter((id) => finalizableIds.has(id)),
    [selected, finalizableIds],
  );
  const allSelected =
    finalizable.length > 0 && selectedIds.length === finalizable.length;

  const toggleOne = (conversationId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(conversationId)) next.delete(conversationId);
      else next.add(conversationId);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected(
      allSelected ? new Set() : new Set(finalizable.map((g) => g.conversationId)),
    );
  };

  const onBulkFinalize = async () => {
    if (bulkRunning || selectedIds.length === 0) return;
    const targets = finalizable.filter((g) => selectedIds.includes(g.conversationId));
    if (
      !window.confirm(
        `${targets.length}건을 최종 승인합니다.\n` +
          "확정 후에는 결정을 되돌릴 수 없고, 기여 적립과 RAG 적재가 진행됩니다. 계속할까요?",
      )
    )
      return;

    setBulkRunning(true);
    setBulkError(null);
    setBulkDone(null);
    let done = 0;
    try {
      // 순차 실행 — finalize 는 ledger 재계산·RAG 적재를 동반하므로 동시 실행하지 않는다.
      for (const g of targets) {
        if (!g.review) continue;
        await reviewService.finalize(g.review.id);
        done += 1;
      }
      setSelected(new Set());
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkDone(done);
      setBulkRunning(false);
    }
  };

  if (!workHydrated || !reviewHydrated || !convHydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>;
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">검수 큐</h1>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            onClick={onBulkFinalize}
            disabled={selectedIds.length === 0 || bulkRunning}
          >
            {bulkRunning
              ? "승인 중…"
              : `일괄 최종 승인 (${selectedIds.length}건)`}
          </Button>
          <p className="text-sm text-muted-foreground">
            {statusFilter === "all"
              ? `${list.length}건`
              : `${list.length} / ${groups.length}건`}
          </p>
        </div>
      </div>

      <FilterChips
        options={STATUS_FILTERS}
        value={statusFilter}
        onChange={setStatusFilter}
        counts={statusCounts}
      />

      {bulkError && (
        <p className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          일괄 승인 중 오류: {bulkError}
          {bulkDone ? ` (${bulkDone}건은 승인 완료)` : ""}
        </p>
      )}
      {!bulkError && bulkDone ? (
        <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {bulkDone}건을 최종 승인했습니다.
        </p>
      ) : null}

      <div className="rounded-xl border bg-card">
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full table-fixed text-sm">
            {/* 대화를 좁히고(35%→28%, ≈80%) 남는 폭을 결정(6%→11%)에 몰아준다. */}
            <colgroup>
              <col className="w-10" />
              <col className="w-[10%]" />
              <col className="w-[28%]" />
              <col className="w-[12%]" />
              <col className="w-[6%]" />
              <col className="w-[12%]" />
              <col className="w-[11%]" />
              <col className="w-[9%]" />
              <col className="w-[92px]" />
            </colgroup>
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <Th>
                  <RowCheckbox
                    checked={allSelected}
                    indeterminate={selectedIds.length > 0}
                    disabled={finalizable.length === 0 || bulkRunning}
                    onChange={toggleAll}
                    label="검수저장된 항목 전체 선택"
                  />
                </Th>
                <SortableTh label="Task" sortKey="task" sort={sort} onSort={toggleSort} />
                <SortableTh label="대화" sortKey="conversation" sort={sort} onSort={toggleSort} />
                <SortableTh label="평가자" sortKey="auditor" sort={sort} onSort={toggleSort} />
                <Th className="text-right">피드백</Th>
                <SortableTh
                  label="제출일"
                  sortKey="submittedAt"
                  sort={sort}
                  onSort={toggleSort}
                />
                <Th>결정</Th>
                <Th>상태</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-muted-foreground">
                    검수할 audit 이 없습니다.
                  </td>
                </tr>
              ) : (
                list.map(({ conversationId, primary, auditorIds, conv, review, fbCount, accepted, rejected, submittedAt }) => (
                  <tr key={conversationId} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <RowCheckbox
                        checked={selectedIds.includes(conversationId)}
                        disabled={
                          !finalizableIds.has(conversationId) || bulkRunning
                        }
                        onChange={() => toggleOne(conversationId)}
                        label={`${conv?.topic.title ?? conversationId} 선택`}
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      <Link
                        href={`/admin/tasks/${primary.taskId}`}
                        title={primary.taskId}
                        className="hover:underline"
                      >
                        {middleTruncate(primary.taskId)}
                      </Link>
                    </td>
                    <td className="px-3 py-2 truncate">
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
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
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
                <div className="flex items-start gap-2">
                  <div className="pt-0.5">
                    <RowCheckbox
                      checked={selectedIds.includes(conversationId)}
                      disabled={
                        !finalizableIds.has(conversationId) || bulkRunning
                      }
                      onChange={() => toggleOne(conversationId)}
                      label={`${conv?.topic.title ?? conversationId} 선택`}
                    />
                  </div>
                  <Link
                    href={`/admin/inspection/${primary.id}`}
                    className="min-w-0 flex-1 hover:underline"
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
