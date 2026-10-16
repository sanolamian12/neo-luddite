"use client";

import { useMemo } from "react";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLedgerHydrated, useLedgerStore } from "@/lib/ledger-store";
import { useAccountStore } from "@/lib/account-store";
import { formatDateTime } from "@/lib/poc-format";
import { cn, middleTruncate } from "@/lib/utils";
import type { LedgerEntry, LedgerKind } from "@/lib/poc-schema";
import { LoadingBlock } from "@/components/ui/spinner";
import { useDemo } from "@/components/demo/runtime";
import { DemoCredits } from "@/components/demo/credits";

const KIND_LABEL: Record<LedgerKind, string> = {
  contribution_accepted: "기여 인정",
  contribution_rejected: "기여 거절",
  settlement_round: "회차 정산",
  bonus: "보너스",
  adjustment: "조정",
};

/**
 * 세무사 '기여 내역'(/audit/ledger) — 내 기여 원장(public.ledger_entries, append-only).
 * 지금 쌓이는 기여 = 공용 KB 사례 반영·철회(0056 kb3_share). 옛 검수·정성 평가·정산 행은 원장에 남아
 * 잔액 사슬을 이루므로 목록에는 그대로 보이되, 회차·인정률·업종 탭은 뺐다(옛 검수 흐름 절단 S1).
 */
export function LedgerView() {
  const demo = useDemo();
  return demo ? <DemoCredits /> : <NormalLedgerView />;
}
function NormalLedgerView() {
  const hydrated = useLedgerHydrated();
  const entries = useLedgerStore((s) => s.entries);
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
    .filter((e) => e.timestamp >= monthStart && e.kind !== "settlement_round")
    .reduce((a, e) => a + e.amount, 0);
  // 공용 KB 에 지금 반영돼 있는 내 사례 수 = 반영 − 철회.
  const sharedNow = Math.max(
    0,
    my.reduce((n, e) => (e.sourceRef.kind === "kb3_share" ? n + (e.sourceRef.event === "approved" ? 1 : -1) : n), 0),
  );

  const onExport = () => {
    const data = {
      auditorId,
      generatedAt: new Date().toISOString(),
      totalCredit,
      monthlyDelta,
      sharedNow,
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
    return <LoadingBlock label="로딩 중…" />;
  }

  return (
    <div className="ds-page flex flex-col gap-8">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">기여 내역</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            가르친 사례가 공용 KB 에 반영되면 +1 cr, 철회되면 −1 cr 이 기록됩니다.
          </p>
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
                  monthlyDelta > 0 && "text-success",
                )}
              >
                {monthlyDelta > 0 ? "+" : ""}
                {monthlyDelta.toLocaleString()} cr
              </span>
            </span>
            <span className="rounded-md bg-card border px-3 py-1.5">
              <span className="text-xs text-muted-foreground">공용 KB 반영 사례</span>
              <span className="ml-2 text-base font-semibold tabular-nums">{sharedNow}건</span>
            </span>
          </div>
        </div>
        <Button variant="outline" onClick={onExport}>
          <Download className="size-3.5" />
          내보내기
        </Button>
      </header>

      <EntriesTable entries={my} />
    </div>
  );
}

export function EntriesTable({ entries, renderSource = sourceLabel }: { entries: LedgerEntry[]; renderSource?: (entry: LedgerEntry) => React.ReactNode }) {
  if (entries.length === 0) {
    return (
      <p className="rounded-md border px-4 py-6 text-sm text-muted-foreground">
        아직 항목이 없습니다.
      </p>
    );
  }
  return (
    <div className="ds-panel">
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
                <td className="px-3 py-2 text-xs">{renderSource(e)}</td>
                <td
                  className={cn(
                    "px-3 py-2 text-right tabular-nums",
                    e.amount > 0 && "text-success",
                    e.amount < 0 && "text-destructive",
                  )}
                >
                  {e.kind === "settlement_round"
                    ? `${e.amount.toLocaleString()}원`
                    : `${e.amount > 0 ? "+" : ""}${e.amount} cr`}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">
                  {e.kind === "settlement_round" ? "—" : `${e.balanceAfter} cr`}
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
              <div className="min-w-0 text-xs">{renderSource(e)}</div>
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
                  e.amount > 0 && "text-success",
                  e.amount < 0 && "text-destructive",
                )}
              >
                {e.kind === "settlement_round"
                  ? `${e.amount.toLocaleString()}원`
                  : `${e.amount > 0 ? "+" : ""}${e.amount} cr`}
              </dd>
              <dt className="text-muted-foreground">잔액</dt>
              <dd className="tabular-nums font-medium">
                {e.kind === "settlement_round" ? "—" : `${e.balanceAfter} cr`}
              </dd>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

const KB3_WITHDRAW_REASON: Record<string, string> = {
  admin_withdrawn: "관리자 철회",
  unpublished: "게시 내림",
  edited: "내용 수정",
  archived: "보관",
  deleted: "삭제",
};

function sourceLabel(e: LedgerEntry): React.ReactNode {
  if (e.sourceRef.kind === "kb3_share") {
    const why = e.sourceRef.reason ? KB3_WITHDRAW_REASON[e.sourceRef.reason] ?? e.sourceRef.reason : "";
    return (
      <span title={e.sourceRef.docId} className="text-muted-foreground">
        공용 KB 사례 · {e.sourceRef.title} · {e.sourceRef.event === "approved" ? "반영" : `철회${why ? `(${why})` : ""}`}
      </span>
    );
  }
  if (e.sourceRef.kind === "kb_contribution") return <span>{e.sourceRef.author} · 제출본 {e.sourceRef.revision} · KB v{e.sourceRef.kbVersion}</span>;
  if (e.sourceRef.kind === "audit") {
    // 옛 문장 검수 기여(10/16 끊김) — 기록만 남는다.
    return (
      <span title={e.sourceRef.auditId} className="text-muted-foreground">
        옛 검수 기여 · 인정 {e.sourceRef.acceptedCount}/{e.sourceRef.acceptedCount + e.sourceRef.rejectedCount}
      </span>
    );
  }
  if (e.sourceRef.kind === "settlement") {
    return (
      <span title={e.sourceRef.roundId} className="text-muted-foreground">
        회차 {middleTruncate(e.sourceRef.roundId)}
      </span>
    );
  }
  if (e.sourceRef.kind === "session_eval") {
    // 옛 정성 평가 기여(10/16 끊김) — 총평 분량 6구간 → 0–5단위.
    return (
      <span title={e.sourceRef.evaluationId} className="text-muted-foreground">
        옛 정성 평가 · {e.sourceRef.accepted ? `${e.sourceRef.units}단위` : "거절"}
      </span>
    );
  }
  return <span className="text-muted-foreground">{e.sourceRef.note ?? "—"}</span>;
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
