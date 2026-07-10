"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLedgerHydrated, useLedgerStore } from "@/lib/ledger-store";
import { useSettlementStore } from "@/lib/settlement-store";
import { useAuditWorkStore } from "@/lib/audit-work-store";
import { useAccountStore } from "@/lib/account-store";
import { conversations } from "@/lib/load-conversation";
import { formatDateTime } from "@/lib/poc-format";
import { cn, middleTruncate } from "@/lib/utils";
import type { LedgerEntry, LedgerKind } from "@/lib/poc-schema";

const KIND_LABEL: Record<LedgerKind, string> = {
  contribution_accepted: "기여 인정",
  contribution_rejected: "기여 거절",
  settlement_round: "회차 정산",
  bonus: "보너스",
  adjustment: "조정",
};

type Tab = "entries" | "rounds" | "categories";

export function LedgerView() {
  const hydrated = useLedgerHydrated();
  const entries = useLedgerStore((s) => s.entries);
  const rounds = useSettlementStore((s) => s.rounds);
  const audits = useAuditWorkStore((s) => s.audits);
  const auditorId = useAccountStore((s) => s.auditor.id);

  const my = useMemo(
    () =>
      entries
        .filter((e) => e.auditorId === auditorId)
        .slice()
        .sort((a, b) => b.timestamp - a.timestamp),
    [entries, auditorId],
  );

  const totalCredit = my[0]?.balanceAfter ?? 0;
  const monthStart = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  }, []);
  const monthlyDelta = my
    .filter((e) => e.timestamp >= monthStart)
    .reduce((a, e) => a + e.amount, 0);

  const auditMap = new Map<string, { accepted: number; rejected: number }>();
  for (const e of my) {
    if (e.sourceRef.kind === "audit") {
      auditMap.set(e.sourceRef.auditId, {
        accepted: e.sourceRef.acceptedCount,
        rejected: e.sourceRef.rejectedCount,
      });
    }
  }
  let totalAccepted = 0;
  let totalRejected = 0;
  for (const v of auditMap.values()) {
    totalAccepted += v.accepted;
    totalRejected += v.rejected;
  }
  const acceptanceRate =
    totalAccepted + totalRejected === 0
      ? 0
      : totalAccepted / (totalAccepted + totalRejected);

  const onExport = () => {
    const data = {
      auditorId,
      generatedAt: new Date().toISOString(),
      totalCredit,
      monthlyDelta,
      acceptanceRate,
      entries: my,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ledger-${auditorId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!hydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>;
  }

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">모델 기여 로그</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded-md bg-card border px-3 py-1.5">
              <span className="text-xs text-muted-foreground">누적</span>
              <span className="ml-2 text-base font-semibold tabular-nums">
                {totalCredit.toLocaleString()} cr
              </span>
            </span>
            <span className="rounded-md bg-card border px-3 py-1.5">
              <span className="text-xs text-muted-foreground">이번 달</span>
              <span
                className={cn(
                  "ml-2 text-base font-semibold tabular-nums",
                  monthlyDelta > 0 && "text-emerald-700",
                )}
              >
                {monthlyDelta > 0 ? "+" : ""}
                {monthlyDelta.toLocaleString()} cr
              </span>
            </span>
            <span className="rounded-md bg-card border px-3 py-1.5">
              <span className="text-xs text-muted-foreground">인정률</span>
              <span className="ml-2 text-base font-semibold tabular-nums">
                {Math.round(acceptanceRate * 100)}%
              </span>
              <span className="ml-1 text-xs text-muted-foreground">
                ({totalAccepted} / {totalAccepted + totalRejected})
              </span>
            </span>
          </div>
        </div>
        <Button variant="outline" onClick={onExport}>
          <Download className="size-3.5" />
          내보내기
        </Button>
      </header>

      <TabsPrimitive.Root defaultValue={"entries" satisfies Tab}>
        <TabsPrimitive.List className="flex gap-2 border-b">
          <TabBtn value="entries">전체 항목</TabBtn>
          <TabBtn value="rounds">회차별</TabBtn>
          <TabBtn value="categories">카테고리별</TabBtn>
        </TabsPrimitive.List>

        <TabsPrimitive.Panel value="entries" className="pt-4">
          <EntriesTable entries={my} />
        </TabsPrimitive.Panel>
        <TabsPrimitive.Panel value="rounds" className="pt-4">
          <RoundsTable rounds={rounds} auditorId={auditorId} />
        </TabsPrimitive.Panel>
        <TabsPrimitive.Panel value="categories" className="pt-4">
          <CategoryBreakdown entries={my} audits={audits} />
        </TabsPrimitive.Panel>
      </TabsPrimitive.Root>
    </div>
  );
}

function TabBtn({ value, children }: { value: Tab; children: React.ReactNode }) {
  return (
    <TabsPrimitive.Tab
      value={value}
      className={cn(
        "px-3 py-2 text-sm text-muted-foreground transition outline-none",
        "hover:text-foreground",
        "data-selected:border-b-2 data-selected:border-foreground data-selected:font-medium data-selected:text-foreground",
      )}
    >
      {children}
    </TabsPrimitive.Tab>
  );
}

function EntriesTable({ entries }: { entries: LedgerEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="rounded-md border px-4 py-6 text-sm text-muted-foreground">
        아직 항목이 없습니다.
      </p>
    );
  }
  return (
    <div className="rounded-xl border bg-card">
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <Th>일자</Th>
              <Th>종류</Th>
              <Th>출처</Th>
              <Th className="text-right">변동</Th>
              <Th className="text-right">잔액</Th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-t">
                <td className="px-3 py-2 text-muted-foreground">{formatDateTime(e.timestamp)}</td>
                <td className="px-3 py-2">
                  <Badge variant="outline">{KIND_LABEL[e.kind]}</Badge>
                </td>
                <td className="px-3 py-2 text-xs">{sourceLabel(e)}</td>
                <td
                  className={cn(
                    "px-3 py-2 text-right tabular-nums",
                    e.amount > 0 && "text-emerald-700",
                    e.amount < 0 && "text-rose-700",
                  )}
                >
                  {e.amount > 0 ? "+" : ""}
                  {e.amount}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">
                  {e.balanceAfter}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y md:hidden">
        {entries.map((e) => (
          <li key={e.id} className="flex flex-col gap-2 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 text-xs">{sourceLabel(e)}</div>
              <Badge variant="outline" className="shrink-0">
                {KIND_LABEL[e.kind]}
              </Badge>
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">일자</dt>
              <dd>{formatDateTime(e.timestamp)}</dd>
              <dt className="text-muted-foreground">변동</dt>
              <dd
                className={cn(
                  "tabular-nums",
                  e.amount > 0 && "text-emerald-700",
                  e.amount < 0 && "text-rose-700",
                )}
              >
                {e.amount > 0 ? "+" : ""}
                {e.amount}
              </dd>
              <dt className="text-muted-foreground">잔액</dt>
              <dd className="tabular-nums font-medium">{e.balanceAfter}</dd>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

function sourceLabel(e: LedgerEntry): React.ReactNode {
  if (e.sourceRef.kind === "audit") {
    return (
      <Link
        href={`/audit/results/${e.sourceRef.auditId}`}
        title={e.sourceRef.auditId}
        className="font-mono hover:underline"
      >
        {middleTruncate(e.sourceRef.auditId)} ({e.sourceRef.acceptedCount}/{e.sourceRef.acceptedCount + e.sourceRef.rejectedCount})
      </Link>
    );
  }
  if (e.sourceRef.kind === "settlement") {
    return (
      <span title={e.sourceRef.roundId} className="text-muted-foreground">
        회차 {middleTruncate(e.sourceRef.roundId)} · audit {e.sourceRef.includedAuditIds.length}건
      </span>
    );
  }
  return <span className="text-muted-foreground">{e.sourceRef.note ?? "—"}</span>;
}

function RoundsTable({
  rounds,
  auditorId,
}: {
  rounds: ReturnType<typeof useSettlementStore.getState>["rounds"];
  auditorId: string;
}) {
  const mine = rounds
    .filter((r) => r.allocations.some((a) => a.auditorId === auditorId))
    .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));

  if (mine.length === 0) {
    return (
      <p className="rounded-md border px-4 py-6 text-sm text-muted-foreground">
        받은 정산 회차가 없습니다.
      </p>
    );
  }
  return (
    <div className="rounded-xl border bg-card">
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <Th>회차</Th>
              <Th>기간</Th>
              <Th className="text-right">분배 받음</Th>
              <Th className="text-right">인정 피드백</Th>
              <Th className="text-right">포함 audit</Th>
              <Th>분배 모델</Th>
            </tr>
          </thead>
          <tbody>
            {mine.map((r) => {
              const a = r.allocations.find((x) => x.auditorId === auditorId)!;
              return (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{r.label}</td>
                  <td className="px-3 py-2 text-muted-foreground text-xs">
                    {formatDateTime(r.periodFrom).slice(0, 10)} →{" "}
                    {formatDateTime(r.periodTo).slice(0, 10)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-700 font-medium">
                    +{a.amount}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {a.acceptedCount}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {a.includedAuditIds.length}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <Badge variant="outline">{r.distributionModel}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="divide-y md:hidden">
        {mine.map((r) => {
          const a = r.allocations.find((x) => x.auditorId === auditorId)!;
          return (
            <li key={r.id} className="flex flex-col gap-2 p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 truncate font-medium">{r.label}</span>
                <Badge variant="outline" className="shrink-0">
                  {r.distributionModel}
                </Badge>
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">기간</dt>
                <dd>
                  {formatDateTime(r.periodFrom).slice(0, 10)} →{" "}
                  {formatDateTime(r.periodTo).slice(0, 10)}
                </dd>
                <dt className="text-muted-foreground">분배 받음</dt>
                <dd className="tabular-nums font-medium text-emerald-700">+{a.amount}</dd>
                <dt className="text-muted-foreground">인정 피드백</dt>
                <dd className="tabular-nums">{a.acceptedCount}</dd>
                <dt className="text-muted-foreground">포함 audit</dt>
                <dd className="tabular-nums">{a.includedAuditIds.length}</dd>
              </dl>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CategoryBreakdown({
  entries,
  audits,
}: {
  entries: LedgerEntry[];
  audits: ReturnType<typeof useAuditWorkStore.getState>["audits"];
}) {
  // 업종(occupation)별 인정 건수
  const byCategory = new Map<string, number>();
  for (const e of entries) {
    if (e.kind !== "contribution_accepted") continue;
    const src = e.sourceRef;
    if (src.kind !== "audit") continue;
    const audit = audits.find((a) => a.id === src.auditId);
    if (!audit) continue;
    const conv = conversations[audit.conversationId];
    if (!conv) continue;
    const key = conv.persona.occupation;
    byCategory.set(key, (byCategory.get(key) ?? 0) + src.acceptedCount);
  }

  const total = [...byCategory.values()].reduce((a, b) => a + b, 0);
  if (total === 0) {
    return (
      <p className="rounded-md border px-4 py-6 text-sm text-muted-foreground">
        분류 가능한 인정 항목이 아직 없습니다.
      </p>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <ul className="flex flex-col gap-2">
        {[...byCategory.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([occ, count]) => {
            const pct = Math.round((count / total) * 100);
            return (
              <li key={occ} className="flex items-center gap-3">
                <span className="w-20 text-sm font-medium">{occ}</span>
                <div className="flex-1">
                  <div className="h-3 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-brand-green"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <span className="tabular-nums text-sm">{count}건</span>
                <span className="w-10 text-right tabular-nums text-xs text-muted-foreground">
                  {pct}%
                </span>
              </li>
            );
          })}
      </ul>
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
    <th className={cn("px-3 py-2 text-left font-medium", className)}>{children}</th>
  );
}
