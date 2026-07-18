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
import * as sessionReviewService from "@/services/session-review";
import { useAuditWorkHydrated, useAuditWorkStore } from "@/lib/audit-work-store";
import { useAuditStore, useAuditHydrated } from "@/lib/audit-store";
import {
  useConversationHydrated,
  useConversationStore,
} from "@/lib/conversation-store";
import { getConversation } from "@/lib/load-conversation";
import { feedbackVolumeLabel, type EvalReviewStatus } from "@/lib/audit-schema";
import { formatDate } from "@/lib/poc-format";
import { middleTruncate } from "@/lib/utils";

/**
 * 검수실 (정성 평가) — 세무사가 남긴 **세션 총평**을 검수하는 목록.
 *
 * 문장 단위 검수실과 결정적으로 다른 점: 저기는 대화 단위로 묶어 모든 평가자의 코멘트를
 * 한 화면에서 결정하지만, 총평은 (대화, 세무사)당 1건이라 여기서는 **세무사별로 한 행**이다.
 * 같은 대화라도 평가한 세무사가 3명이면 3행이 된다.
 */

const STATUS_LABEL: Record<EvalReviewStatus, string> = {
  pending: "검수 대기",
  saved: "검수 저장",
  finalized: "최종 승인",
};

function statusVariant(
  s: EvalReviewStatus,
): "default" | "outline" | "secondary" {
  if (s === "finalized") return "default";
  if (s === "saved") return "outline";
  return "secondary";
}

type StatusFilter = "all" | EvalReviewStatus;
type SortKey = "submittedAt" | "task" | "conversation" | "auditor";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "pending", label: STATUS_LABEL.pending },
  { value: "saved", label: STATUS_LABEL.saved },
  { value: "finalized", label: STATUS_LABEL.finalized },
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

export function InspectionEvalTable() {
  const workHydrated = useAuditWorkHydrated();
  const auditHydrated = useAuditHydrated();
  const convHydrated = useConversationHydrated();
  const audits = useAuditWorkStore((s) => s.audits);
  const evaluations = useAuditStore((s) => s.evaluations);
  const convRecords = useConversationStore((s) => s.records);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkDone, setBulkDone] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortState<SortKey>>({
    key: "submittedAt",
    dir: "desc",
  });

  // 총평 1건 = 1행. 대응하는 audit 이 제출된 것만 검수 대상으로 본다
  // (작성 중 draft 의 총평은 아직 "제출된 의견"이 아니다).
  const rows = useMemo(() => {
    const auditByPair = new Map<string, (typeof audits)[number]>();
    for (const a of audits) {
      if (a.status === "draft" || a.status === "cancelled") continue;
      auditByPair.set(`${a.conversationId} ${a.auditorId}`, a);
    }

    return evaluations
      .map((e) => {
        const audit = auditByPair.get(`${e.conversationId} ${e.auditorId}`);
        if (!audit) return null;
        const conv = getConversation(e.conversationId);
        return {
          evaluation: e,
          audit,
          conv,
          title: conv?.topic.title ?? e.conversationId,
          submittedAt: audit.submittedAt ?? e.createdAt,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audits, evaluations, convRecords]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: rows.length };
    for (const r of rows) {
      const s = r.evaluation.reviewStatus;
      counts[s] = (counts[s] ?? 0) + 1;
    }
    return counts;
  }, [rows]);

  const list = useMemo(() => {
    const filtered =
      statusFilter === "all"
        ? rows
        : rows.filter((r) => r.evaluation.reviewStatus === statusFilter);

    const factor = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sort.key) {
        case "task":
          return factor * compareText(a.audit.taskId, b.audit.taskId);
        case "conversation":
          return factor * compareText(a.title, b.title);
        case "auditor":
          return (
            factor *
            compareText(a.evaluation.auditorId, b.evaluation.auditorId)
          );
        default:
          return factor * (a.submittedAt - b.submittedAt);
      }
    });
  }, [rows, statusFilter, sort]);

  const toggleSort = (key: SortKey) => setSort((prev) => nextSort(prev, key));

  // 일괄 최종 승인 대상 = 검수 저장(saved)까지 끝난 건.
  const finalizable = useMemo(
    () => list.filter((r) => r.evaluation.reviewStatus === "saved"),
    [list],
  );
  const finalizableIds = useMemo(
    () => new Set(finalizable.map((r) => r.evaluation.id)),
    [finalizable],
  );
  const selectedIds = useMemo(
    () => [...selected].filter((id) => finalizableIds.has(id)),
    [selected, finalizableIds],
  );
  const allSelected =
    finalizable.length > 0 && selectedIds.length === finalizable.length;

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected(
      allSelected ? new Set() : new Set(finalizable.map((r) => r.evaluation.id)),
    );

  const onBulkFinalize = async () => {
    if (bulkRunning || selectedIds.length === 0) return;
    if (
      !window.confirm(
        `${selectedIds.length}건을 최종 승인합니다.\n` +
          "확정 후에는 결정을 되돌릴 수 없고, 기여 적립과 RAG 적재가 진행됩니다. 계속할까요?",
      )
    )
      return;

    setBulkRunning(true);
    setBulkError(null);
    setBulkDone(null);
    let done = 0;
    try {
      // 순차 실행 — finalize 는 ledger 적립·RAG 적재를 동반하므로 동시 실행하지 않는다.
      for (const id of selectedIds) {
        await sessionReviewService.finalize(id);
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

  if (!workHydrated || !auditHydrated || !convHydrated) {
    return (
      <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            검수 큐 — 정성 평가
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            세무사가 남긴 세션 총평을 검수합니다. 인정된 총평은 최종 승인 시 기여로
            적립되고 RAG 에 적재됩니다.
          </p>
        </div>
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
              : `${list.length} / ${rows.length}건`}
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
            <colgroup>
              <col className="w-[10%]" />
              <col className="w-[26%]" />
              <col className="w-[12%]" />
              <col className="w-[11%]" />
              <col className="w-[12%]" />
              <col className="w-[13%]" />
              <col className="w-[10%]" />
              <col className="w-10" />
              <col className="w-[92px]" />
            </colgroup>
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <SortableTh
                  label="Task"
                  sortKey="task"
                  sort={sort}
                  onSort={toggleSort}
                />
                <SortableTh
                  label="대화"
                  sortKey="conversation"
                  sort={sort}
                  onSort={toggleSort}
                />
                <SortableTh
                  label="평가자"
                  sortKey="auditor"
                  sort={sort}
                  onSort={toggleSort}
                />
                <Th>피드백</Th>
                <SortableTh
                  label="제출일"
                  sortKey="submittedAt"
                  sort={sort}
                  onSort={toggleSort}
                />
                <Th>평점</Th>
                <Th>상태</Th>
                <Th>
                  <RowCheckbox
                    checked={allSelected}
                    indeterminate={selectedIds.length > 0}
                    disabled={finalizable.length === 0 || bulkRunning}
                    onChange={toggleAll}
                    label="검수저장된 항목 전체 선택"
                  />
                </Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="py-12 text-center text-muted-foreground"
                  >
                    검수할 정성 평가가 없습니다.
                  </td>
                </tr>
              ) : (
                list.map(({ evaluation, audit, title, submittedAt }) => (
                  <tr key={evaluation.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs">
                      <Link
                        href={`/admin/tasks/${audit.taskId}`}
                        title={audit.taskId}
                        className="hover:underline"
                      >
                        {middleTruncate(audit.taskId)}
                      </Link>
                    </td>
                    <td className="truncate px-3 py-2">
                      <Link
                        href={`/admin/inspection-eval/${encodeURIComponent(evaluation.id)}`}
                        title={title}
                        className="hover:underline"
                      >
                        {title}
                      </Link>
                    </td>
                    <td
                      className="truncate px-3 py-2"
                      title={evaluation.auditorId}
                    >
                      {evaluation.reviewer}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      {feedbackVolumeLabel(evaluation.qualitative)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatDate(submittedAt)}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      <span title="문장력">
                        문장 {evaluation.scores.writing}/5
                      </span>
                      {" · "}
                      <span title="법률적 정확성">
                        법률 {evaluation.scores.legalAccuracy}/5
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={statusVariant(evaluation.reviewStatus)}>
                        {STATUS_LABEL[evaluation.reviewStatus]}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <RowCheckbox
                        checked={selectedIds.includes(evaluation.id)}
                        disabled={
                          !finalizableIds.has(evaluation.id) || bulkRunning
                        }
                        onChange={() => toggleOne(evaluation.id)}
                        label={`${title} 선택`}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        render={
                          <Link
                            href={`/admin/inspection-eval/${encodeURIComponent(evaluation.id)}`}
                          />
                        }
                      >
                        {evaluation.reviewStatus === "pending" ? "검수" : "보기"}
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
            검수할 정성 평가가 없습니다.
          </div>
        ) : (
          <ul className="divide-y md:hidden">
            {list.map(({ evaluation, audit, title, submittedAt }) => (
              <li key={evaluation.id} className="flex flex-col gap-2 p-3">
                <div className="flex items-start gap-2">
                  <div className="pt-0.5">
                    <RowCheckbox
                      checked={selectedIds.includes(evaluation.id)}
                      disabled={
                        !finalizableIds.has(evaluation.id) || bulkRunning
                      }
                      onChange={() => toggleOne(evaluation.id)}
                      label={`${title} 선택`}
                    />
                  </div>
                  <Link
                    href={`/admin/inspection-eval/${encodeURIComponent(evaluation.id)}`}
                    className="min-w-0 flex-1 hover:underline"
                  >
                    <div className="truncate font-medium">{title}</div>
                    <span
                      title={audit.taskId}
                      className="font-mono text-xs text-muted-foreground"
                    >
                      {middleTruncate(audit.taskId)}
                    </span>
                  </Link>
                  <Badge variant={statusVariant(evaluation.reviewStatus)}>
                    {STATUS_LABEL[evaluation.reviewStatus]}
                  </Badge>
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <div>
                    <dt className="inline">평가자 </dt>
                    <dd className="inline text-foreground">
                      {evaluation.reviewer}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">피드백 </dt>
                    <dd className="inline text-foreground">
                      {feedbackVolumeLabel(evaluation.qualitative)}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">제출일 </dt>
                    <dd className="inline text-foreground tabular-nums">
                      {formatDate(submittedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">평점 </dt>
                    <dd className="inline text-foreground tabular-nums">
                      문장 {evaluation.scores.writing}/5 · 법률{" "}
                      {evaluation.scores.legalAccuracy}/5
                    </dd>
                  </div>
                </dl>
                <div className="flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    render={
                      <Link
                        href={`/admin/inspection-eval/${encodeURIComponent(evaluation.id)}`}
                      />
                    }
                  >
                    {evaluation.reviewStatus === "pending" ? "검수" : "보기"}
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

function Th({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th className={`px-3 py-2 text-left font-medium ${className ?? ""}`}>
      {children}
    </th>
  );
}
