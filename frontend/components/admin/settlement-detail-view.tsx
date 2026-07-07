"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useSettlementHydrated,
  useSettlementStore,
} from "@/lib/settlement-store";
import {
  useAuditorRegistryHydrated,
  useAuditorRegistryStore,
} from "@/lib/auditor-registry-store";
import { useAccountStore } from "@/lib/account-store";
import { formatDate, formatDateTime } from "@/lib/poc-format";
import * as settlementService from "@/services/settlement";

const MODEL_LABEL: Record<string, string> = {
  even: "균등 (1/N)",
  weighted_by_count: "기여도 비례",
};

export function SettlementDetailView({ roundId }: { roundId: string }) {
  const hydrated = useSettlementHydrated();
  const auditorsHydrated = useAuditorRegistryHydrated();
  const round = useSettlementStore((s) =>
    s.rounds.find((r) => r.id === roundId),
  );
  const auditors = useAuditorRegistryStore((s) => s.auditors);
  const adminId = useAccountStore((s) => s.admin.id);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameOf = useMemo(() => {
    const map = new Map(auditors.map((a) => [a.id, a.displayName]));
    return (id: string) => map.get(id) ?? id;
  }, [auditors]);

  const summary = useMemo(() => {
    if (!round) return { total: 0, paid: 0, accepted: 0, unpaidIds: [] as string[] };
    const paid = round.allocations.filter((a) => a.paidAt != null).length;
    const accepted = round.allocations.reduce((s, a) => s + a.acceptedCount, 0);
    const unpaidIds = round.allocations
      .filter((a) => a.paidAt == null)
      .map((a) => a.auditorId);
    return { total: round.allocations.length, paid, accepted, unpaidIds };
  }, [round]);

  if (!hydrated || !auditorsHydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>;
  }

  if (!round) {
    return (
      <div className="flex flex-col gap-4 px-6 py-6">
        <BackLink />
        <p className="text-sm text-muted-foreground">
          회차를 찾을 수 없습니다.
        </p>
      </div>
    );
  }

  const allUnpaidSelected =
    summary.unpaidIds.length > 0 &&
    summary.unpaidIds.every((id) => selected.has(id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected(allUnpaidSelected ? new Set() : new Set(summary.unpaidIds));

  const onMarkPaid = async () => {
    if (selected.size === 0) return;
    setError(null);
    setBusy(true);
    try {
      await settlementService.markPaid(round.id, [...selected], adminId);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 px-6 py-6 max-w-4xl">
      <div className="flex flex-col gap-1">
        <BackLink />
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">{round.label}</h1>
          <Badge variant={round.status === "published" ? "default" : "secondary"}>
            {round.status === "published" ? "발행됨" : "초안"}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          대상 기간 {formatDate(round.periodFrom)} → {formatDate(round.periodTo)} ·
          발행 {formatDateTime(round.publishedAt)} · 분배 모델{" "}
          {MODEL_LABEL[round.distributionModel] ?? round.distributionModel}
        </p>
        {round.note && (
          <p className="mt-1 text-sm text-muted-foreground">{round.note}</p>
        )}
      </div>

      {/* 요약 */}
      <section className="grid grid-cols-2 gap-3 rounded-xl border bg-card md:grid-cols-4 divide-x">
        <SummaryCell label="참여 평가자" value={`${summary.total}명`} />
        <SummaryCell label="활성 기여 합계" value={`${summary.accepted}건`} />
        <SummaryCell label="분배 pool" value={`${round.pool.toLocaleString()} cr`} />
        <SummaryCell
          label="입금 완료"
          value={`${summary.paid}/${summary.total}`}
          accent={summary.paid === summary.total ? "done" : "pending"}
        />
      </section>

      {/* 분배 목록 + 일괄 입금 처리 */}
      <section className="rounded-xl border bg-card">
        <header className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
          <span className="text-sm font-semibold">분배 목록</span>
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <span className="text-xs text-muted-foreground">
                {selected.size}명 선택
              </span>
            )}
            <Button
              size="sm"
              onClick={onMarkPaid}
              disabled={busy || selected.size === 0}
            >
              {busy ? "처리 중…" : "입금 처리"}
            </Button>
          </div>
        </header>

        {error && (
          <div className="border-b bg-destructive/5 px-4 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  checked={allUnpaidSelected}
                  onChange={toggleAll}
                  disabled={summary.unpaidIds.length === 0}
                  aria-label="입금 전 전체 선택"
                />
              </th>
              <th className="px-3 py-2 text-left font-medium">평가자</th>
              <th className="px-3 py-2 text-right font-medium">기여</th>
              <th className="px-3 py-2 text-right font-medium">포함 audit</th>
              <th className="px-3 py-2 text-right font-medium">분배</th>
              <th className="px-3 py-2 text-left font-medium">입금 상태</th>
            </tr>
          </thead>
          <tbody>
            {round.allocations.map((a) => {
              const paid = a.paidAt != null;
              return (
                <tr key={a.auditorId} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(a.auditorId)}
                      onChange={() => toggle(a.auditorId)}
                      disabled={paid}
                      aria-label={`${nameOf(a.auditorId)} 선택`}
                    />
                  </td>
                  <td className="px-3 py-2 font-medium">
                    {nameOf(a.auditorId)}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {a.auditorId}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {a.acceptedCount}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {a.includedAuditIds.length > 0
                      ? `${a.includedAuditIds.length}건`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-emerald-700">
                    +{a.amount} cr
                  </td>
                  <td className="px-3 py-2">
                    {paid ? (
                      <div className="flex items-center gap-1.5">
                        <Badge variant="default">입금 완료</Badge>
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {formatDateTime(a.paidAt)}
                        </span>
                      </div>
                    ) : (
                      <Badge variant="outline">입금 전</Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/admin/settlement"
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-3.5" />
      정산 회차 목록
    </Link>
  );
}

function SummaryCell({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "done" | "pending";
}) {
  return (
    <div className="px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={
          "mt-0.5 text-xl font-semibold tabular-nums" +
          (accent === "done"
            ? " text-emerald-700"
            : accent === "pending"
              ? " text-brand-amber-foreground"
              : "")
        }
      >
        {value}
      </p>
    </div>
  );
}
