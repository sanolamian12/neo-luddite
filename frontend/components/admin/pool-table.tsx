"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useConversationHydrated,
  useConversationStore,
  type ConversationRecord,
} from "@/lib/conversation-store";
import { useAuditTaskStore } from "@/lib/audit-task-store";
import { OCCUPATIONS, getOccupation } from "@/lib/occupations";
import { formatDateTime } from "@/lib/poc-format";
import { middleTruncate } from "@/lib/utils";
import * as conversationService from "@/services/conversation";
import type { PoolSortKey } from "@/services/conversation";

/**
 * 하차장 — 사장님이 만든 채팅창의 "5분 정지 스냅샷" 목록.
 *
 * 원천: public.conversations (snapshot_at != null). 라이브 진행 중(사진 전) 대화는
 * 노출되지 않는다. 관리자는 정렬(생성시간·종류·소유자)·제목 검색·100 페이징으로
 * 훑고, 행을 다중 선택해 일감(Task)으로 배치한다. (구 pool_candidates·엑셀 폐지)
 */

type StatusFilter = "all" | "new" | "assigned" | "excluded";
const PAGE_SIZE = 100;

const SORT_OPTIONS: { key: PoolSortKey; label: string }[] = [
  { key: "created_desc", label: "생성 최신순" },
  { key: "created_asc", label: "생성 오래된순" },
  { key: "occupation", label: "종류순" },
  { key: "owner", label: "소유자(가나다)" },
];

function recordTitle(c: ConversationRecord): string {
  return c.title ?? c.snapshotPayload?.topic.title ?? c.id;
}

export function PoolTable() {
  const convHydrated = useConversationHydrated();
  const records = useConversationStore((s) => s.records);
  const tasks = useAuditTaskStore((s) => s.tasks);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [occupation, setOccupation] = useState<string>("all");
  const [sort, setSort] = useState<PoolSortKey>("created_desc");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  // 필터를 바꾸면 1페이지로 되돌린다(setter 를 감싸 effect 없이 처리).
  const changeStatus = (v: StatusFilter) => {
    setStatusFilter(v);
    setPage(1);
  };
  const changeOccupation = (v: string) => {
    setOccupation(v);
    setPage(1);
  };
  const changeSort = (v: PoolSortKey) => {
    setSort(v);
    setPage(1);
  };
  const changeQ = (v: string) => {
    setQ(v);
    setPage(1);
  };

  // 배정됨 = 어떤 Task 든 이 conversationId 를 포함(파생, write-back 없음).
  const assignedIds = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) for (const cid of t.conversationIds) set.add(cid);
    return set;
  }, [tasks]);

  const eligible = useMemo(() => {
    // records 를 의존성으로 두어 Realtime 갱신 시 재계산.
    void records;
    const includeExcluded = statusFilter === "excluded";
    let list = conversationService.queryPool({
      q: q.trim() || undefined,
      occupation: occupation === "all" ? undefined : occupation,
      sort,
      includeExcluded,
    });
    if (statusFilter === "excluded") {
      list = list.filter((c) => c.excludedAt != null);
    } else if (statusFilter === "new") {
      list = list.filter((c) => !assignedIds.has(c.id));
    } else if (statusFilter === "assigned") {
      list = list.filter((c) => assignedIds.has(c.id));
    }
    return list;
  }, [records, q, occupation, sort, statusFilter, assignedIds]);

  const total = eligible.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount);
  const pageItems = eligible.slice(
    (clampedPage - 1) * PAGE_SIZE,
    clampedPage * PAGE_SIZE,
  );

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // 전체 선택 = 현재 페이지의 모든 행이 대상.
  // (제외 뷰=복원 대상, 그 외 뷰=제외/Task 대상 — 한 뷰 안에서는 동질적)
  const pageSelectable = pageItems;
  const allPageSelected =
    pageSelectable.length > 0 && pageSelectable.every((c) => selected.has(c.id));
  const somePageSelected = pageSelectable.some((c) => selected.has(c.id));

  const toggleAllPage = () =>
    setSelected((s) => {
      const next = new Set(s);
      if (allPageSelected) for (const c of pageSelectable) next.delete(c.id);
      else for (const c of pageSelectable) next.add(c.id);
      return next;
    });

  // 선택은 제외되지 않은 후보만 유효(일감·제외 대상).
  const selectableSelected = useMemo(
    () =>
      [...selected].filter((id) => {
        const c = records.find((x) => x.id === id);
        return c && c.snapshotAt != null && c.excludedAt == null;
      }),
    [selected, records],
  );

  // 복원 대상 = 선택된 제외 항목(제외 뷰에서만 의미).
  const restorableSelected = useMemo(
    () =>
      [...selected].filter((id) => {
        const c = records.find((x) => x.id === id);
        return c && c.excludedAt != null;
      }),
    [selected, records],
  );

  if (!convHydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>;
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">하차장 — 상담 스냅샷</h1>
        <p className="text-sm text-muted-foreground">
          사진 찍힌 {records.filter((c) => c.snapshotAt != null && c.excludedAt == null).length}건 · 표시 {total}건
        </p>
      </div>

      {/* 검색 / 정렬 / 종류 */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => changeQ(e.target.value)}
          placeholder="제목·소유자·ID 검색"
          className="h-9 w-64"
        />
        <select
          value={occupation}
          onChange={(e) => changeOccupation(e.target.value)}
          className="h-9 rounded-md border bg-background px-2 text-sm"
          aria-label="종류 필터"
        >
          <option value="all">전체 종류</option>
          {OCCUPATIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.emoji} {o.label}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => changeSort(e.target.value as PoolSortKey)}
          className="h-9 rounded-md border bg-background px-2 text-sm"
          aria-label="정렬"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* 상태 칩 + 배치 액션 */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip active={statusFilter === "all"} onClick={() => changeStatus("all")}>
          전체
        </FilterChip>
        <FilterChip active={statusFilter === "new"} onClick={() => changeStatus("new")}>
          신규
        </FilterChip>
        <FilterChip active={statusFilter === "assigned"} onClick={() => changeStatus("assigned")}>
          배정됨
        </FilterChip>
        <FilterChip active={statusFilter === "excluded"} onClick={() => changeStatus("excluded")}>
          제외
        </FilterChip>

        <div className="ml-auto flex items-center gap-2">
          {statusFilter === "excluded" ? (
            <>
              <span className="text-xs text-muted-foreground">선택 {restorableSelected.length}건</span>
              <Button
                size="sm"
                disabled={restorableSelected.length === 0}
                onClick={async () => {
                  for (const id of restorableSelected) await conversationService.setExcluded(id, false);
                  setSelected(new Set());
                }}
              >
                일괄 복원
              </Button>
            </>
          ) : (
            <>
              <span className="text-xs text-muted-foreground">선택 {selectableSelected.length}건</span>
              <Button
                size="sm"
                disabled={selectableSelected.length === 0}
                render={
                  <Link
                    href={`/admin/tasks/new?conversationIds=${encodeURIComponent(
                      selectableSelected.join(","),
                    )}`}
                  />
                }
              >
                일괄 Task 등록
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={selectableSelected.length === 0}
                onClick={async () => {
                  for (const id of selectableSelected) await conversationService.setExcluded(id, true);
                  setSelected(new Set());
                }}
              >
                일괄 제외
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="rounded-xl border bg-card">
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <Th className="w-10">
                  <SelectAllCheckbox
                    checked={allPageSelected}
                    indeterminate={somePageSelected}
                    onChange={toggleAllPage}
                    disabled={pageSelectable.length === 0}
                  />
                </Th>
                <Th>제목</Th>
                <Th>종류</Th>
                <Th className="w-48">소유자</Th>
                <Th className="text-right">Turn</Th>
                <Th>생성시간</Th>
                <Th>상태</Th>
              </tr>
            </thead>
            <tbody>
              {pageItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-muted-foreground">
                    {records.some((c) => c.snapshotAt != null)
                      ? "조건에 맞는 상담이 없습니다."
                      : "아직 사진 찍힌 상담이 없습니다. 사장님이 채팅을 시작하면 5분 뒤 이곳에 나타납니다."}
                  </td>
                </tr>
              ) : (
                pageItems.map((c) => (
                  <Row
                    key={c.id}
                    c={c}
                    assigned={assignedIds.has(c.id)}
                    selected={selected.has(c.id)}
                    onToggle={() => toggle(c.id)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* 모바일: 카드 리스트 */}
        {pageItems.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground md:hidden">
            {records.some((c) => c.snapshotAt != null)
              ? "조건에 맞는 상담이 없습니다."
              : "아직 사진 찍힌 상담이 없습니다. 사장님이 채팅을 시작하면 5분 뒤 이곳에 나타납니다."}
          </div>
        ) : (
          <ul className="divide-y md:hidden">
            <li className="flex items-center gap-2 bg-muted/40 px-3 py-2">
              <SelectAllCheckbox
                checked={allPageSelected}
                indeterminate={somePageSelected}
                onChange={toggleAllPage}
                disabled={pageSelectable.length === 0}
              />
              <span className="text-xs font-medium text-muted-foreground">전체 선택</span>
            </li>
            {pageItems.map((c) => (
              <Card
                key={c.id}
                c={c}
                assigned={assignedIds.has(c.id)}
                selected={selected.has(c.id)}
                onToggle={() => toggle(c.id)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* 페이징 */}
      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button size="sm" variant="outline" disabled={clampedPage <= 1} onClick={() => setPage(clampedPage - 1)}>
            이전
          </Button>
          <span className="text-xs text-muted-foreground">
            {clampedPage} / {pageCount}
          </span>
          <Button size="sm" variant="outline" disabled={clampedPage >= pageCount} onClick={() => setPage(clampedPage + 1)}>
            다음
          </Button>
        </div>
      )}
    </div>
  );
}

function Row({
  c,
  assigned,
  selected,
  onToggle,
}: {
  c: ConversationRecord;
  assigned: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const occ = getOccupation(c.occupation);
  const excluded = c.excludedAt != null;
  return (
    <tr className="border-t hover:bg-muted/30">
      <td className="px-3 py-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`${recordTitle(c)} 선택`}
        />
      </td>
      <td className="px-3 py-2 max-w-[320px] truncate">
        <Link href={`/admin/pool/${encodeURIComponent(c.id)}`} className="hover:underline">
          {recordTitle(c)}
        </Link>
      </td>
      <td className="px-3 py-2">
        <Badge variant="outline">{occ ? `${occ.emoji} ${occ.label}` : c.occupation}</Badge>
      </td>
      <td className="px-3 py-2 w-48 max-w-[192px] truncate">{c.ownerLabel ?? c.ownerId}</td>
      <td className="px-3 py-2 text-right tabular-nums">{c.turnCount}</td>
      <td className="px-3 py-2 text-muted-foreground">{formatDateTime(c.createdAt)}</td>
      <td className="px-3 py-2">
        {excluded ? (
          <Badge variant="ghost">제외</Badge>
        ) : assigned ? (
          <Badge variant="secondary">배정됨</Badge>
        ) : (
          <Badge variant="default">신규</Badge>
        )}
      </td>
    </tr>
  );
}

function Card({
  c,
  assigned,
  selected,
  onToggle,
}: {
  c: ConversationRecord;
  assigned: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const occ = getOccupation(c.occupation);
  const excluded = c.excludedAt != null;
  return (
    <li className="flex flex-col gap-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <label className="flex min-w-0 items-start gap-2">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`${recordTitle(c)} 선택`}
            className="mt-1"
          />
          <Link
            href={`/admin/pool/${encodeURIComponent(c.id)}`}
            className="min-w-0 hover:underline"
          >
            <div className="truncate font-medium">{recordTitle(c)}</div>
            <span title={c.id} className="font-mono text-xs text-muted-foreground">
              {middleTruncate(c.id)}
            </span>
          </Link>
        </label>
        {excluded ? (
          <Badge variant="ghost">제외</Badge>
        ) : assigned ? (
          <Badge variant="secondary">배정됨</Badge>
        ) : (
          <Badge variant="default">신규</Badge>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <div className="col-span-2">
          <dt className="inline">종류 </dt>
          <dd className="inline text-foreground">
            {occ ? `${occ.emoji} ${occ.label}` : c.occupation}
          </dd>
        </div>
        <div>
          <dt className="inline">소유자 </dt>
          <dd className="inline text-foreground">{c.ownerLabel ?? c.ownerId}</dd>
        </div>
        <div>
          <dt className="inline">Turn </dt>
          <dd className="inline text-foreground tabular-nums">{c.turnCount}</dd>
        </div>
        <div className="col-span-2">
          <dt className="inline">생성시간 </dt>
          <dd className="inline text-foreground tabular-nums">
            {formatDateTime(c.createdAt)}
          </dd>
        </div>
      </dl>
    </li>
  );
}

function SelectAllCheckbox({
  checked,
  indeterminate,
  onChange,
  disabled,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // 일부만 선택된 상태(indeterminate)는 DOM 프로퍼티라 ref 로만 설정 가능.
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !checked && indeterminate;
  }, [checked, indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      aria-label="전체 선택"
    />
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-medium ${className ?? ""}`}>{children}</th>;
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button size="sm" variant={active ? "default" : "outline"} onClick={onClick}>
      {children}
    </Button>
  );
}
