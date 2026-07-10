"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  ClipboardList,
  FolderCheck,
  Inbox,
  ListChecks,
  TrendingUp,
  Wallet,
  Activity as ActivityIcon,
} from "lucide-react";
import { Sparkline } from "@/components/ui/sparkline";
import { useAccountHydrated, useAccountStore } from "@/lib/account-store";
import {
  useAuditTaskHydrated,
  useAuditTaskStore,
} from "@/lib/audit-task-store";
import { useAuditWorkHydrated, useAuditWorkStore } from "@/lib/audit-work-store";
import { useReviewHydrated, useReviewStore } from "@/lib/review-store";
import { useMailHydrated, useMailStore } from "@/lib/mail-store";
import { useLedgerHydrated, useLedgerStore } from "@/lib/ledger-store";
import { conversations } from "@/lib/load-conversation";
import { Badge } from "@/components/ui/badge";
import { cn, middleTruncate } from "@/lib/utils";
import {
  AUDIT_STATUS_LABEL,
  auditStatusVariant,
  formatDateTime,
} from "@/lib/poc-format";

export function DashboardView() {
  const accountHydrated = useAccountHydrated();
  const taskHydrated = useAuditTaskHydrated();
  const workHydrated = useAuditWorkHydrated();
  const reviewHydrated = useReviewHydrated();
  const mailHydrated = useMailHydrated();
  const ledgerHydrated = useLedgerHydrated();

  const auditor = useAccountStore((s) => s.auditor);
  const tasks = useAuditTaskStore((s) => s.tasks);
  const audits = useAuditWorkStore((s) => s.audits);
  const reviews = useReviewStore((s) => s.reviews);
  const mails = useMailStore((s) => s.mails);
  const ledgerEntries = useLedgerStore((s) => s.entries);

  const myAudits = useMemo(
    () => audits.filter((a) => a.auditorId === auditor.id),
    [audits, auditor.id],
  );
  const myAuditIds = useMemo(() => new Set(myAudits.map((a) => a.id)), [myAudits]);
  const myMails = useMemo(
    () => mails.filter((m) => m.recipientId === auditor.id),
    [mails, auditor.id],
  );
  const myEntries = useMemo(
    () => ledgerEntries.filter((e) => e.auditorId === auditor.id),
    [ledgerEntries, auditor.id],
  );

  const stats = useMemo(() => {
    const pickupAvail = tasks.filter((t) => {
      if (t.status !== "open" && t.status !== "in_progress") return false;
      if (t.pickups.some((p) => p.auditorId === auditor.id)) return false;
      return t.pickups.length < t.capacity;
    }).length;
    const drafts = myAudits.filter((a) => a.status === "draft").length;
    const submittedPendingReview = myAudits.filter(
      (a) => a.status === "submitted",
    ).length;
    const unseenResults = reviews.filter(
      (r) =>
        (r.status === "saved" || r.status === "finalized") &&
        myAuditIds.has(r.auditId) &&
        !r.seenByAuditorAt,
    ).length;
    const unreadMails = myMails.filter((m) => !m.readAt).length;
    return { pickupAvail, drafts, submittedPendingReview, unseenResults, unreadMails };
  }, [tasks, myAudits, reviews, myAuditIds, myMails, auditor.id]);

  const ledgerSummary = useMemo(() => {
    if (myEntries.length === 0)
      return { total: 0, monthly: 0, acceptanceRate: 0, accepted: 0, rejected: 0, series: [] as number[] };
    const sorted = myEntries.slice().sort((a, b) => b.timestamp - a.timestamp);
    const total = sorted[0].balanceAfter;
    const series = myEntries
      .slice()
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((e) => e.balanceAfter);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const monthly = myEntries
      .filter((e) => e.timestamp >= monthStart)
      .reduce((a, e) => a + e.amount, 0);
    const auditMap = new Map<string, { a: number; r: number }>();
    for (const e of myEntries) {
      if (e.sourceRef.kind === "audit") {
        auditMap.set(e.sourceRef.auditId, {
          a: e.sourceRef.acceptedCount,
          r: e.sourceRef.rejectedCount,
        });
      }
    }
    let accepted = 0;
    let rejected = 0;
    for (const v of auditMap.values()) {
      accepted += v.a;
      rejected += v.r;
    }
    const acceptanceRate =
      accepted + rejected === 0 ? 0 : accepted / (accepted + rejected);
    return { total, monthly, acceptanceRate, accepted, rejected, series };
  }, [myEntries]);

  const activity = useMemo(() => {
    type Item = {
      ts: number;
      label: string;
      sub?: string;
      href?: string;
      key: string;
    };
    const items: Item[] = [];
    for (const a of myAudits) {
      if (a.submittedAt)
        items.push({
          ts: a.submittedAt,
          label: `Audit ${middleTruncate(a.id)} 제출`,
          sub: conversations[a.conversationId]?.topic.title,
          href: `/audit/results/${a.id}`,
          key: `submit-${a.id}`,
        });
      const r = reviews.find((x) => x.auditId === a.id);
      if (r?.finalizedAt)
        items.push({
          ts: r.finalizedAt,
          label: `결과물 ${middleTruncate(a.id)} 검수 완료`,
          sub: `인정 ${r.decisions.filter((d) => d.accepted).length} / ${r.decisions.length}`,
          href: `/audit/results/${a.id}`,
          key: `review-${a.id}`,
        });
    }
    for (const m of myMails.slice(-10)) {
      items.push({
        ts: m.sentAt,
        label: `우편: "${m.subject}"`,
        href: `/audit/mailbox`,
        key: `mail-${m.id}`,
      });
    }
    for (const e of myEntries.slice(-10)) {
      if (e.kind === "settlement_round")
        items.push({
          ts: e.timestamp,
          label: `회차 정산 +${e.amount} cr`,
          href: `/audit/ledger`,
          key: `ledger-${e.id}`,
        });
    }
    return items.sort((a, b) => b.ts - a.ts).slice(0, 8);
  }, [myAudits, reviews, myMails, myEntries]);

  if (
    !accountHydrated ||
    !taskHydrated ||
    !workHydrated ||
    !reviewHydrated ||
    !mailHydrated ||
    !ledgerHydrated
  ) {
    return (
      <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>
    );
  }

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">
          안녕하세요, {auditor.reviewerName} 님
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          오늘의 활동과 누적 기여 현황입니다.
        </p>
      </header>

      {/* 1행: 히어로 — 모델 기여 로그 + 인정률 */}
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Link
          href="/audit/ledger"
          className="group relative overflow-hidden rounded-2xl border border-brand-green/30 bg-brand-green/8 p-5 transition hover:border-brand-green/50 lg:col-span-2"
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-brand-green-foreground/80">
                <span className="flex size-7 items-center justify-center rounded-lg bg-brand-green/20 text-brand-green-foreground">
                  <Wallet className="size-4" />
                </span>
                모델 기여 로그
              </div>
              <p className="mt-3 text-4xl font-bold tabular-nums text-brand-green-foreground">
                {ledgerSummary.total.toLocaleString()}
                <span className="ml-1 text-lg font-medium text-brand-green-foreground/60">cr</span>
              </p>
              <p
                className={cn(
                  "mt-1 text-sm font-medium tabular-nums",
                  ledgerSummary.monthly > 0
                    ? "text-emerald-700"
                    : "text-muted-foreground",
                )}
              >
                이번 달 {ledgerSummary.monthly > 0 ? "+" : ""}
                {ledgerSummary.monthly.toLocaleString()} cr
              </p>
            </div>
          </div>
          {ledgerSummary.series.length >= 2 && (
            <Sparkline
              data={ledgerSummary.series}
              className="mt-3 w-full text-brand-green-foreground"
              width={320}
              height={48}
            />
          )}
        </Link>

        <div className="rounded-2xl border bg-card p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">인정률 (lifetime)</p>
            <TrendingUp className="size-4 text-brand-green" />
          </div>
          <p className="mt-2 text-4xl font-bold tabular-nums">
            {Math.round(ledgerSummary.acceptanceRate * 100)}%
          </p>
          <div className="mt-3">
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-brand-green transition-[width] duration-500"
                style={{ width: `${ledgerSummary.acceptanceRate * 100}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              총 {ledgerSummary.accepted + ledgerSummary.rejected}건 중{" "}
              {ledgerSummary.accepted}건 인정
            </p>
          </div>
        </div>
      </section>

      {/* 2행: 활동 카드 */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="픽업 가능"
          value={stats.pickupAvail}
          href="/audit/queue"
          icon={ClipboardList}
          accent="blue"
        />
        <StatCard
          label="진행 중"
          value={stats.drafts}
          href="/audit/work"
          icon={ListChecks}
          accent={stats.drafts > 0 ? "amber" : "neutral"}
        />
        <StatCard
          label="검수 대기"
          value={stats.submittedPendingReview}
          href="/audit/results"
          icon={FolderCheck}
          accent="green"
          dot={stats.unseenResults > 0}
          dotCount={stats.unseenResults}
        />
        <StatCard
          label="미확인 우편"
          value={stats.unreadMails}
          href="/audit/mailbox"
          icon={Inbox}
          accent={stats.unreadMails > 0 ? "amber" : "neutral"}
          dot={stats.unreadMails > 0}
        />
      </section>

      {/* 3행: 최근 활동 (타임라인) */}
      <section className="rounded-xl border bg-card">
        <header className="flex items-center gap-2 border-b px-4 py-2.5 text-sm font-semibold">
          <ActivityIcon className="size-4 text-brand-green" />
          최근 활동
        </header>
        {activity.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            아직 활동이 없습니다. 참여하기에서 새 작업을 가져와 보세요.
          </p>
        ) : (
          <ul className="px-4 py-3">
            {activity.map((it, i) => (
              <li key={it.key} className="relative flex gap-3 pb-3 last:pb-0">
                <div className="flex flex-col items-center">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-green ring-4 ring-brand-green/15" />
                  {i < activity.length - 1 && (
                    <span className="mt-1 w-px flex-1 bg-border" />
                  )}
                </div>
                <Link
                  href={it.href ?? "#"}
                  className="-mt-1 min-w-0 flex-1 rounded-lg px-2 py-1 hover:bg-muted/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm">{it.label}</p>
                    <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                      {formatDateTime(it.ts)}
                    </span>
                  </div>
                  {it.sub && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {it.sub}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 진행 중 audit 미리보기 */}
      {myAudits.filter((a) => a.status === "draft").length > 0 && (
        <section className="rounded-xl border bg-card">
          <header className="flex items-center justify-between border-b px-4 py-2">
            <span className="text-sm font-semibold">진행 중인 작업</span>
            <Link href="/audit/work" className="text-xs underline">
              모두 보기 →
            </Link>
          </header>
          <ul className="divide-y">
            {myAudits
              .filter((a) => a.status === "draft")
              .slice(0, 3)
              .map((a) => {
                const conv = conversations[a.conversationId];
                return (
                  <li key={a.id} className="px-4 py-2.5">
                    <Link
                      href={`/audit/work/${a.id}`}
                      className="flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {conv?.topic.title ?? a.conversationId}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          피드백 {a.progress.feedbackCount} · 평가{" "}
                          {a.progress.hasSessionEval ? "✓" : "—"}
                        </p>
                      </div>
                      <Badge variant={auditStatusVariant(a.status)}>
                        {AUDIT_STATUS_LABEL[a.status]}
                      </Badge>
                    </Link>
                  </li>
                );
              })}
          </ul>
        </section>
      )}
    </div>
  );
}

const ACCENT_CHIP: Record<string, string> = {
  neutral: "bg-muted text-muted-foreground",
  blue: "bg-brand-blue/15 text-brand-blue",
  green: "bg-brand-green/20 text-brand-green-foreground",
  amber: "bg-brand-amber/20 text-brand-amber-foreground",
};

const ACCENT_BORDER: Record<string, string> = {
  neutral: "",
  blue: "",
  green: "",
  amber: "border-brand-amber/40",
};

function StatCard({
  label,
  value,
  href,
  icon: Icon,
  accent = "neutral",
  dot,
  dotCount,
}: {
  label: string;
  value: number;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: "neutral" | "blue" | "green" | "amber";
  dot?: boolean;
  dotCount?: number;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "block rounded-xl border bg-card p-4 transition hover:border-foreground/30 hover:shadow-sm",
        value > 0 && ACCENT_BORDER[accent],
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="flex items-center gap-1.5">
          {dot && dotCount !== undefined && dotCount > 0 && (
            <span className="rounded-full bg-brand-green px-1.5 text-[10px] font-medium text-brand-green-foreground tabular-nums">
              {dotCount}
            </span>
          )}
          {dot && dotCount === undefined && (
            <span className="size-1.5 rounded-full bg-brand-amber" aria-hidden />
          )}
          <span className={cn("flex size-7 items-center justify-center rounded-lg", ACCENT_CHIP[accent])}>
            <Icon className="size-4" />
          </span>
        </div>
      </div>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
    </Link>
  );
}
