"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePoolHydrated, usePoolStore } from "@/lib/pool-store";
import { useAuditTaskHydrated, useAuditTaskStore } from "@/lib/audit-task-store";
import { getOccupation } from "@/lib/occupations";
import * as poolService from "@/services/pool";
import type { PoolCandidate, PoolStatus } from "@/lib/poc-schema";

const STATUS_LABEL: Record<PoolStatus, string> = {
  new: "신규",
  assigned: "배정됨",
  excluded: "제외",
};

const STATUS_VARIANT: Record<PoolStatus, "default" | "secondary" | "outline" | "ghost"> = {
  new: "default",
  assigned: "secondary",
  excluded: "ghost",
};

export function PoolTable() {
  const poolHydrated = usePoolHydrated();
  const tasksHydrated = useAuditTaskHydrated();
  const candidates = usePoolStore((s) => s.candidates);
  const tasks = useAuditTaskStore((s) => s.tasks);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<PoolStatus | "all">("all");

  // 모든 task 에 포함된 conversationId 의 assigned 동기화 (1회만, idempotent)
  useEffect(() => {
    if (!tasksHydrated || !poolHydrated) return;
    const assignedSet = new Set<string>();
    for (const t of tasks) for (const c of t.conversationIds) assignedSet.add(c);
    const toMark = candidates.filter(
      (c) => assignedSet.has(c.conversationId) && c.status === "new",
    );
    if (toMark.length === 0) return;
    // DB 로 반영 (구: 스토어 직접 patch). markAssigned 가 낙관적 갱신도 수행.
    void poolService.markAssigned(toMark.map((c) => c.conversationId));
  }, [tasksHydrated, poolHydrated, tasks, candidates]);

  const filtered = useMemo(() => {
    const list = [...candidates];
    list.sort((a, b) => b.addedAt - a.addedAt);
    if (statusFilter === "all") return list;
    return list.filter((c) => c.status === statusFilter);
  }, [candidates, statusFilter]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectedNew = useMemo(
    () =>
      [...selected].filter((id) => {
        const c = candidates.find((x) => x.conversationId === id);
        return c?.status === "new";
      }),
    [selected, candidates],
  );

  if (!poolHydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>;
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">감사 후보 풀</h1>
        <p className="text-sm text-muted-foreground">
          전체 {candidates.length}건 · 표시 {filtered.length}건
        </p>
      </div>

      <div className="flex items-center gap-2">
        <FilterChip
          active={statusFilter === "all"}
          onClick={() => setStatusFilter("all")}
        >
          전체
        </FilterChip>
        <FilterChip
          active={statusFilter === "new"}
          onClick={() => setStatusFilter("new")}
        >
          신규
        </FilterChip>
        <FilterChip
          active={statusFilter === "assigned"}
          onClick={() => setStatusFilter("assigned")}
        >
          배정됨
        </FilterChip>
        <FilterChip
          active={statusFilter === "excluded"}
          onClick={() => setStatusFilter("excluded")}
        >
          제외
        </FilterChip>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            선택 {selectedNew.length}건
          </span>
          <Button
            size="sm"
            disabled={selectedNew.length === 0}
            render={
              <Link
                href={`/admin/tasks/new?conversationIds=${encodeURIComponent(
                  selectedNew.join(","),
                )}`}
              />
            }
          >
            일괄 Task 등록
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={selectedNew.length === 0}
            onClick={async () => {
              for (const id of selectedNew) await poolService.exclude(id);
              setSelected(new Set());
            }}
          >
            일괄 제외
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <Th className="w-10"></Th>
              <Th>Conv ID</Th>
              <Th>업종</Th>
              <Th>토픽</Th>
              <Th className="text-right">Turn</Th>
              <Th>추가일</Th>
              <Th>상태</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-muted-foreground">
                  표시할 후보가 없습니다.
                </td>
              </tr>
            ) : (
              filtered.map((c) => <Row key={c.conversationId} c={c} selected={selected.has(c.conversationId)} onToggle={() => toggle(c.conversationId)} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({
  c,
  selected,
  onToggle,
}: {
  c: PoolCandidate;
  selected: boolean;
  onToggle: () => void;
}) {
  const occ = getOccupation(c.occupation);
  return (
    <tr className="border-t hover:bg-muted/30">
      <td className="px-3 py-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          disabled={c.status !== "new"}
          aria-label={`${c.conversationId} 선택`}
        />
      </td>
      <td className="px-3 py-2 font-mono text-xs">
        <Link
          href={`/admin/pool/${encodeURIComponent(c.conversationId)}`}
          className="hover:underline"
        >
          {c.conversationId}
        </Link>
      </td>
      <td className="px-3 py-2">
        <Badge variant="outline">{occ ? `${occ.emoji} ${occ.label}` : c.occupation}</Badge>
      </td>
      <td className="px-3 py-2 max-w-[280px] truncate">{c.topic ?? "—"}</td>
      <td className="px-3 py-2 text-right tabular-nums">{c.turnCount}</td>
      <td className="px-3 py-2 text-muted-foreground">{formatDate(c.addedAt)}</td>
      <td className="px-3 py-2">
        <Badge variant={STATUS_VARIANT[c.status]}>{STATUS_LABEL[c.status]}</Badge>
      </td>
      <td className="px-3 py-2 text-right">
        {c.status === "new" && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => poolService.exclude(c.conversationId)}
          >
            제외
          </Button>
        )}
      </td>
    </tr>
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
    <Button
      size="sm"
      variant={active ? "default" : "outline"}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
