"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { LoadingBlock } from "@/components/ui/spinner";
import { FEEDBACK_TAGS, FEEDBACK_TAG_LABELS } from "@/lib/audit-schema";
import { useAuditHydrated, useAuditStore } from "@/lib/audit-store";
import { useAuditWorkHydrated, useAuditWorkStore } from "@/lib/audit-work-store";
import { formatDateTime } from "@/lib/poc-format";
import { useReviewHydrated, useReviewStore } from "@/lib/review-store";
import { summarize, type Tally } from "@/lib/sentence-review-summary";
import { middleTruncate } from "@/lib/utils";

/**
 * 문장 대조 집계 (A10, 10/16) — 운영 답변 문장에 단 코멘트를 분류·평가자·대화·월별로 모은다.
 * 흐름: AI상담세션 후보(/admin/pool) → 평가중(일감) → 세무사 문장 코멘트 → 검수실 결정 → 최종 승인 = RAG 환류.
 * 같은 정의의 스크립트: backend/eval/sentence_review_check.py (rag.passages 적재 수까지 센다).
 */

const RANGES = [
  { value: "all", label: "전체 기간", since: 0 },
  { value: "v3", label: "새 화면 이후 (10/4~)", since: Date.UTC(2026, 9, 4) },
  { value: "30d", label: "최근 30일", since: -30 },
] as const;

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");

function Row({ label, t, extra }: { label: React.ReactNode; t: Tally; extra?: React.ReactNode }) {
  return (
    <tr className="border-t">
      <td className="px-3 py-2">{label}</td>
      {extra}
      <td className="px-3 py-2 text-right tabular-nums">{t.comments}</td>
      <td className="px-3 py-2 text-right tabular-nums">{t.accepted}</td>
      <td className="px-3 py-2 text-right tabular-nums">{t.rejected}</td>
      <td className="px-3 py-2 text-right tabular-nums">{t.undecided}</td>
      <td className="px-3 py-2 text-right tabular-nums">{pct(t.accepted, t.accepted + t.rejected)}</td>
    </tr>
  );
}

function Head({ first, extra }: { first: string; extra?: string[] }) {
  return (
    <thead className="bg-muted/50 text-xs text-muted-foreground">
      <tr>
        <th className="px-3 py-2 text-left font-medium">{first}</th>
        {extra?.map((h) => <th key={h} className="px-3 py-2 text-right font-medium">{h}</th>)}
        {["코멘트", "인정", "거절", "미결정", "인정률"].map((h) => <th key={h} className="px-3 py-2 text-right font-medium">{h}</th>)}
      </tr>
    </thead>
  );
}

export function SentenceReviewSummaryView() {
  const ready = [useAuditHydrated(), useAuditWorkHydrated(), useReviewHydrated()].every(Boolean);
  const feedback = useAuditStore((s) => s.feedback);
  const audits = useAuditWorkStore((s) => s.audits);
  const reviews = useReviewStore((s) => s.reviews);
  const [range, setRange] = useState<(typeof RANGES)[number]["value"]>("all");
  // '최근 30일' 기준 시각은 범위를 고를 때 한 번 정한다(렌더마다 Date.now() 를 부르지 않게).
  const [now, setNow] = useState(0);

  const s = useMemo(() => {
    const r = RANGES.find((x) => x.value === range)!;
    const since = r.since < 0 ? now + r.since * 86_400_000 : r.since;
    return summarize(feedback, reviews, audits, since);
  }, [feedback, reviews, audits, range, now]);

  if (!ready) return <LoadingBlock />;
  const { total, coverage } = s;

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><BarChart3 className="size-6" />문장 대조 집계</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            운영 답변 문장에 단 코멘트를 분류·평가자·대화별로 모읍니다. 인정·거절은 검수실 결정이고, 최종 승인된 인정 코멘트가 RAG 로 환류됩니다.
          </p>
        </div>
        <select aria-label="기간" className="rounded-md border bg-background px-2 py-1.5 text-sm" value={range}
          onChange={(e) => { setNow(Date.now()); setRange(e.target.value as typeof range); }}>
          {RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </header>

      <section aria-label="요약" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["코멘트", `${total.comments}건`, `대화 ${total.conversations} · 문장 ${total.segments}`],
          ["인정률", pct(total.accepted, total.accepted + total.rejected), `인정 ${total.accepted} · 거절 ${total.rejected} · 미결정 ${total.undecided}`],
          ["RAG 환류", `${s.finalizedAccepted}건`, "최종 승인된 인정 코멘트"],
          ["문장 범위", pct(coverage.commentedSegments, coverage.totalSegments), `제출 검수 ${coverage.audits} · 문장 ${coverage.commentedSegments}/${coverage.totalSegments}`],
        ].map(([k, v, sub]) => (
          <div key={k} className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground">{k}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{v}</p>
            <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
          </div>
        ))}
      </section>
      {total.comments > 0 && <p className="text-xs text-muted-foreground">기간 {formatDateTime(total.first!)} ~ {formatDateTime(total.last!)}</p>}

      {total.comments === 0 ? (
        <p className="rounded-md border px-3 py-6 text-center text-sm text-muted-foreground">
          이 기간에 단 문장 코멘트가 없습니다. <Link className="underline" href="/admin/pool">AI상담세션 후보</Link>에서 대화를 골라 일감을 만들면 세무사가 문장마다 의견을 남길 수 있습니다.
        </p>
      ) : <>
        <section aria-label="분류별" className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <Head first="분류" />
            <tbody>{FEEDBACK_TAGS.map((t) => <Row key={t} label={FEEDBACK_TAG_LABELS[t]} t={s.byTag[t]} />)}</tbody>
          </table>
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">코멘트 하나에 분류가 여럿이면 각 분류에 셉니다.</p>
        </section>

        <section aria-label="평가자별" className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <Head first="평가자" extra={["대화"]} />
            <tbody>{s.byAuditor.map((a) => (
              <Row key={a.auditorId} label={<Link className="hover:underline" href={`/admin/auditors/${a.auditorId}`}>{a.auditorId}</Link>} t={a}
                extra={<td className="px-3 py-2 text-right tabular-nums">{a.conversations}</td>} />
            ))}</tbody>
          </table>
        </section>

        <section aria-label="대화별" className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <Head first="대화" extra={["문장"]} />
            <tbody>{s.byConversation.slice(0, 50).map((c) => (
              <Row key={c.conversationId} t={c}
                label={<Link className="font-mono hover:underline" title={c.conversationId} href={`/admin/pool/${c.conversationId}`}>{middleTruncate(c.conversationId)}</Link>}
                extra={<td className="px-3 py-2 text-right tabular-nums">{c.segments}{c.totalSegments ? ` / ${c.totalSegments}` : ""}</td>} />
            ))}</tbody>
          </table>
          {s.byConversation.length > 50 && <p className="border-t px-3 py-2 text-xs text-muted-foreground">코멘트 많은 순 50개만 보입니다(전체 {s.byConversation.length}).</p>}
        </section>

        <section aria-label="월별" className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground"><tr>
              {["월", "코멘트", "대화", "인정"].map((h, i) => <th key={h} className={`px-3 py-2 font-medium ${i ? "text-right" : "text-left"}`}>{h}</th>)}
            </tr></thead>
            <tbody>{s.byMonth.map((m) => (
              <tr key={m.month} className="border-t">
                <td className="px-3 py-2">{m.month}</td>
                <td className="px-3 py-2 text-right tabular-nums">{m.comments}</td>
                <td className="px-3 py-2 text-right tabular-nums">{m.conversations}</td>
                <td className="px-3 py-2 text-right tabular-nums">{m.accepted}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      </>}
    </div>
  );
}
