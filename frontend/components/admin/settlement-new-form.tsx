"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAccountStore } from "@/lib/account-store";
import { useLedgerHydrated } from "@/lib/ledger-store";
import * as settlementService from "@/services/settlement";
import type {
  SettlementDistributionModel,
  SettlementAllocation,
} from "@/lib/poc-schema";

const MODELS: { id: SettlementDistributionModel; label: string; hint: string }[] = [
  { id: "even", label: "균등 (1/N)", hint: "참여자 수로 균등 분배" },
  { id: "weighted_by_count", label: "인정 건수 비례", hint: "인정 피드백 수에 비례" },
];

function defaultLabel(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-1`;
}

function defaultMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const to = new Date(now.getFullYear(), now.getMonth(), 0);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export function SettlementNewForm() {
  const router = useRouter();
  const ledgerHydrated = useLedgerHydrated();
  const adminId = useAccountStore((s) => s.admin.id);

  const initial = useMemo(() => defaultMonthRange(), []);
  const [label, setLabel] = useState(defaultLabel());
  const [fromStr, setFromStr] = useState(initial.from);
  const [toStr, setToStr] = useState(initial.to);
  const [pool, setPool] = useState(300);
  const [model, setModel] = useState<SettlementDistributionModel>(
    "weighted_by_count",
  );
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<{
    allocations: SettlementAllocation[];
    totalAccepted: number;
    participants: number;
  } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 미리보기 자동 갱신
  useEffect(() => {
    if (!ledgerHydrated) return;
    const from = new Date(fromStr + "T00:00:00").getTime();
    const to = new Date(toStr + "T23:59:59").getTime();
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) return;
    let cancelled = false;
    (async () => {
      const result = await settlementService.preview({
        periodFrom: from,
        periodTo: to,
        pool,
        distributionModel: model,
      });
      if (!cancelled) setPreview(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [fromStr, toStr, pool, model, ledgerHydrated]);

  const onPublish = async () => {
    setError(null);
    const from = new Date(fromStr + "T00:00:00").getTime();
    const to = new Date(toStr + "T23:59:59").getTime();
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
      setError("기간 입력이 잘못되었습니다.");
      return;
    }
    if (!label.trim()) {
      setError("회차 라벨이 필요합니다.");
      return;
    }
    if (!preview || preview.participants === 0) {
      setError("대상 인정 피드백이 없습니다.");
      return;
    }
    setPublishing(true);
    try {
      const round = await settlementService.publish({
        label: label.trim(),
        periodFrom: from,
        periodTo: to,
        pool,
        distributionModel: model,
        createdBy: adminId,
        note: note.trim() || undefined,
      });
      router.push(`/admin/settlement`);
      void round;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPublishing(false);
    }
  };

  if (!ledgerHydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>;
  }

  return (
    <div className="flex flex-col gap-6 px-6 py-6 max-w-3xl">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">새 정산 회차</h1>
        <Button variant="ghost" render={<Link href="/admin/settlement" />}>
          취소
        </Button>
      </div>

      <Section title="기본 정보">
        <label className="text-xs font-medium text-muted-foreground">회차 라벨</label>
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="예: 2026-07-1"
          className="h-9"
        />
      </Section>

      <Section title="대상 기간">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            value={fromStr}
            onChange={(e) => setFromStr(e.target.value)}
            className="h-8 w-44"
          />
          <span className="text-sm text-muted-foreground">→</span>
          <Input
            type="date"
            value={toStr}
            onChange={(e) => setToStr(e.target.value)}
            className="h-8 w-44"
          />
          <p className="text-xs text-muted-foreground">
            (기간 내 인정 ledger entry 중 미정산 항목이 대상)
          </p>
        </div>
      </Section>

      <Section title="분배 모델">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {MODELS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setModel(m.id)}
              className={`rounded-md border px-3 py-2 text-left transition outline-none ${
                model === m.id
                  ? "border-foreground bg-foreground/5"
                  : "hover:border-foreground/40"
              }`}
            >
              <p className="text-sm font-medium">{m.label}</p>
              <p className="text-xs text-muted-foreground">{m.hint}</p>
            </button>
          ))}
        </div>
      </Section>

      <Section title="회차 pool">
        <Input
          type="number"
          value={pool}
          onChange={(e) => setPool(Number(e.target.value) || 0)}
          className="h-8 w-44"
        />
        <p className="text-xs text-muted-foreground">총 credit 분배 풀</p>
      </Section>

      <Section title="메모 (선택)">
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="추가 메모"
        />
      </Section>

      <section className="rounded-xl border bg-card">
        <header className="border-b px-4 py-2 text-sm font-semibold">미리보기</header>
        {!preview || preview.participants === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            기간 내 미정산 인정 피드백이 없습니다.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 divide-x text-sm">
              <div className="px-4 py-3">
                <p className="text-xs text-muted-foreground">참여 평가자</p>
                <p className="mt-0.5 text-xl font-semibold tabular-nums">
                  {preview.participants}
                </p>
              </div>
              <div className="px-4 py-3">
                <p className="text-xs text-muted-foreground">인정 피드백 합계</p>
                <p className="mt-0.5 text-xl font-semibold tabular-nums">
                  {preview.totalAccepted}
                </p>
              </div>
              <div className="px-4 py-3">
                <p className="text-xs text-muted-foreground">분배 pool</p>
                <p className="mt-0.5 text-xl font-semibold tabular-nums">
                  {pool.toLocaleString()} cr
                </p>
              </div>
            </div>
            <ul className="divide-y text-sm">
              {preview.allocations.map((a) => (
                <li key={a.auditorId} className="flex items-center justify-between px-4 py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{a.auditorId}</span>
                    <Badge variant="outline" className="text-[10px]">
                      인정 {a.acceptedCount}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      audit {a.includedAuditIds.length}건
                    </span>
                  </div>
                  <span className="tabular-nums text-emerald-700 font-medium">
                    +{a.amount} cr
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" render={<Link href="/admin/settlement" />}>
          취소
        </Button>
        <Button onClick={onPublish} disabled={publishing}>
          {publishing ? "발행 중…" : "회차 발행"}
        </Button>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}
