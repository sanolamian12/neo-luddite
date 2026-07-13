"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type SortDir = "asc" | "desc";
export interface SortState<K extends string> {
  key: K;
  dir: SortDir;
}

/** 가나다·abc 비교 — ko 로케일(코드포인트 비교가 아니라 실제 사전순). */
export function compareText(a: string, b: string): number {
  return a.localeCompare(b, "ko");
}

/**
 * 정렬 상태 토글러 — 같은 열을 다시 누르면 오름↔내림, 다른 열이면 오름차순으로 시작.
 */
export function nextSort<K extends string>(
  prev: SortState<K>,
  key: K,
): SortState<K> {
  return prev.key === key
    ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
    : { key, dir: "asc" };
}

/** 클릭으로 오름/내림을 토글하는 표 헤더 셀. */
export function SortableTh<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey: K;
  sort: SortState<K>;
  onSort: (key: K) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th className={cn("px-3 py-2 text-left font-medium", className)}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-sort={
          active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
        }
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          active && "text-foreground",
        )}
      >
        {label}
        {active ? (
          sort.dir === "asc" ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )
        ) : (
          <ArrowUpDown className="size-3 opacity-40" />
        )}
      </button>
    </th>
  );
}

/** 상태 필터 칩 줄 — 값별 건수를 함께 보여준다. */
export function FilterChips<V extends string>({
  options,
  value,
  onChange,
  counts,
}: {
  options: { value: V; label: string }[];
  value: V;
  onChange: (v: V) => void;
  counts: Record<string, number>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-full border px-3 py-1 text-xs transition-colors",
            value === o.value
              ? "border-primary bg-primary text-primary-foreground"
              : "bg-card text-muted-foreground hover:bg-muted",
          )}
        >
          {o.label}
          <span className="ml-1 tabular-nums opacity-70">
            {counts[o.value] ?? 0}
          </span>
        </button>
      ))}
    </div>
  );
}
