"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  Activity as ActivityIcon,
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  GitPullRequest,
  Inbox,
  Info,
  MessagesSquare,
  Package,
  ShieldCheck,
} from "lucide-react";
import { Sparkline } from "@/components/ui/sparkline";
import { useConversationHydrated, useConversationStore } from "@/lib/conversation-store";
import {
  useAuditTaskHydrated,
  useAuditTaskStore,
} from "@/lib/audit-task-store";
import { useAuditWorkHydrated, useAuditWorkStore } from "@/lib/audit-work-store";
import { useReviewStore, useReviewHydrated } from "@/lib/review-store";
import { useInquiryStore, useInquiryHydrated } from "@/lib/inquiry-store";
import { useLedgerStore } from "@/lib/ledger-store";
import { useAccountStore } from "@/lib/account-store";
import { cn } from "@/lib/utils";
import { formatDateTime, formatRemaining } from "@/lib/poc-format";

export function AdminDashboardView() {
  const poolHydrated = useConversationHydrated();
  const taskHydrated = useAuditTaskHydrated();
  const workHydrated = useAuditWorkHydrated();
  const reviewHydrated = useReviewHydrated();
  const inqHydrated = useInquiryHydrated();

  const adminName = useAccountStore((s) => s.admin.operatorName);
  const records = useConversationStore((s) => s.records);
  const tasks = useAuditTaskStore((s) => s.tasks);
  const audits = useAuditWorkStore((s) => s.audits);
  const reviews = useReviewStore((s) => s.reviews);
  const inquiries = useInquiryStore((s) => s.inquiries);
  const ledger = useLedgerStore((s) => s.entries);

  const stages = useMemo(() => {
    // 하차장 후보 = 사진 찍힘 & 미제외. 신규 = 그 중 미배정.
    const assignedIds = new Set<string>();
    for (const t of tasks) for (const cid of t.conversationIds) assignedIds.add(cid);
    const eligible = records.filter(
      (c) => c.snapshotAt != null && c.excludedAt == null,
    );
    const poolNew = eligible.filter((c) => !assignedIds.has(c.id)).length;
    const taskActive = tasks.filter(
      (t) => t.status === "open" || t.status === "in_progress" || t.status === "full",
    ).length;
    const totalPickups = tasks.reduce((a, t) => a + t.pickups.length, 0);
    const totalCapacity = tasks.reduce((a, t) => a + t.capacity, 0);
    const inspectionCount = audits.filter((a) => a.status === "submitted").length;
    const reviewed = audits.filter(
      (a) => a.status === "reviewed" || a.status === "finalized",
    ).length;
    const finalizedReviews = reviews.filter((r) => r.status === "finalized").length;
    return {
      poolNew,
      poolTotal: eligible.length,
      taskActive,
      pickupsRatio: `${totalPickups}/${totalCapacity}`,
      inspectionCount,
      reviewed,
      finalizedReviews,
    };
  }, [records, tasks, audits, reviews]);

  const alerts = useMemo(() => {
    const out: { kind: "warn" | "info"; label: string; href?: string }[] = [];
    // Tasks 마감 24h 이내 with empty slot
    const now = Date.now();
    for (const t of tasks) {
      if (t.status === "closed") continue;
      if (t.pickups.length >= t.capacity) continue;
      const diff = t.deadline - now;
      if (diff > 0 && diff < 24 * 60 * 60 * 1000) {
        out.push({
          kind: "warn",
          label: `Task ${t.id.slice(0, 14)} 마감 24h 이내 (픽업 ${t.pickups.length}/${t.capacity})`,
          href: `/admin/tasks/${t.id}`,
        });
      }
    }
    // 미답변 inquiries 2일 이상
    for (const q of inquiries) {
      if (q.status !== "open") continue;
      const diff = now - q.raisedAt;
      if (diff > 2 * 24 * 60 * 60 * 1000) {
        out.push({
          kind: "warn",
          label: `Inquiry ${q.id.slice(0, 14)} 응답 대기 ${Math.floor(diff / 86400000)}일`,
          href: `/admin/inquiries`,
        });
      }
    }
    // 미정산 인정 피드백
    const accumulated = ledger.filter(
      (e) => e.kind === "contribution_accepted",
    ).length;
    const settled = ledger.filter((e) => e.kind === "settlement_round").length;
    if (accumulated > 0 && settled === 0) {
      out.push({
        kind: "info",
        label: `미정산 인정 ledger entry ${accumulated}건 — 회차 정산 검토`,
        href: `/admin/settlement/new`,
      });
    }
    return out;
  }, [tasks, inquiries, ledger]);

  const events = useMemo(() => {
    type Ev = { ts: number; label: string; href?: string; key: string };
    const items: Ev[] = [];
    for (const a of audits) {
      if (a.submittedAt)
        items.push({
          ts: a.submittedAt,
          label: `Audit ${a.id.slice(0, 12)} 제출`,
          href: `/admin/inspection/${a.id}`,
          key: `submit-${a.id}`,
        });
    }
    for (const r of reviews) {
      if (r.finalizedAt)
        items.push({
          ts: r.finalizedAt,
          label: `Review ${r.id.slice(0, 12)} 확정`,
          href: `/admin/inspection/${r.auditId}`,
          key: `review-${r.id}`,
        });
    }
    for (const q of inquiries) {
      items.push({
        ts: q.raisedAt,
        label: `Inquiry ${q.id.slice(0, 12)} 제기`,
        href: `/admin/inquiries`,
        key: `inq-${q.id}`,
      });
    }
    return items.sort((a, b) => b.ts - a.ts).slice(0, 8);
  }, [audits, reviews, inquiries]);

  // 최근 7일 일별 활동량(제출+확정+이의제기) — 추세 스파크라인용
  const throughput = useMemo(() => {
    const day = 86_400_000;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = today.getTime() - 6 * day;
    const buckets = new Array(7).fill(0);
    const bump = (ts?: number) => {
      if (!ts) return;
      const idx = Math.floor((ts - start) / day);
      if (idx >= 0 && idx < 7) buckets[idx] += 1;
    };
    for (const a of audits) bump(a.submittedAt);
    for (const r of reviews) bump(r.finalizedAt);
    for (const q of inquiries) bump(q.raisedAt);
    return buckets;
  }, [audits, reviews, inquiries]);

  if (
    !poolHydrated ||
    !taskHydrated ||
    !workHydrated ||
    !reviewHydrated ||
    !inqHydrated
  ) {
    return (
      <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>
    );
  }

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">상황실</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {adminName} · lifecycle 단계별 현황과 경보.
        </p>
      </header>

      {/* 1행: 히어로 — 처리 대기 + 인정 확정 */}
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="relative overflow-hidden rounded-2xl border border-brand-amber/30 bg-brand-amber/8 p-5 lg:col-span-2">
          <div className="flex items-center gap-2 text-xs font-medium text-brand-amber-foreground/80">
            <span className="flex size-7 items-center justify-center rounded-lg bg-brand-amber/25 text-brand-amber-foreground">
              <ShieldCheck className="size-4" />
            </span>
            처리 대기
          </div>
          <div className="mt-3 flex items-end gap-6">
            <Link href="/admin/inspection" className="group">
              <p className="text-4xl font-bold tabular-nums text-brand-amber-foreground group-hover:underline">
                {stages.inspectionCount}
              </p>
              <p className="mt-0.5 text-xs text-brand-amber-foreground/70">검수 대기</p>
            </Link>
            <Link href="/admin/inquiries" className="group">
              <p className="text-3xl font-semibold tabular-nums text-brand-amber-foreground/90 group-hover:underline">
                {inquiries.filter((q) => q.status === "open").length}
              </p>
              <p className="mt-0.5 text-xs text-brand-amber-foreground/70">미답변 이의제기</p>
            </Link>
          </div>
          <div className="mt-4 flex items-end justify-between gap-3">
            <p className="text-[11px] text-brand-amber-foreground/60">최근 7일 활동</p>
            <Sparkline
              data={throughput}
              className="text-brand-amber-foreground"
              width={220}
              height={40}
            />
          </div>
        </div>

        <Link
          href="/admin/settlement"
          className="group rounded-2xl border bg-card p-5 transition hover:border-foreground/30"
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">인정 확정</p>
            <Package className="size-4 text-brand-green" />
          </div>
          <p className="mt-2 text-4xl font-bold tabular-nums">{stages.finalizedReviews}</p>
          <p className="mt-2 text-xs text-muted-foreground group-hover:underline">
            회차 정산 검토 →
          </p>
        </Link>
      </section>

      {/* 2행: 흐름 단계 카드 */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StageCard
          label="후보 풀"
          headline={stages.poolNew}
          sub={`누적 ${stages.poolTotal}`}
          href="/admin/pool"
          icon={Inbox}
          accent="blue"
        />
        <StageCard
          label="진행 중 Task"
          headline={stages.taskActive}
          sub={`픽업 ${stages.pickupsRatio}`}
          href="/admin/tasks"
          icon={ClipboardList}
          accent="blue"
        />
        <StageCard
          label="검수 대기"
          headline={stages.inspectionCount}
          sub={`완료 ${stages.reviewed}`}
          href="/admin/inspection"
          icon={ShieldCheck}
          accent={stages.inspectionCount > 0 ? "amber" : "neutral"}
        />
        <StageCard
          label="인정 (확정)"
          headline={stages.finalizedReviews}
          sub="회차 정산 검토"
          href="/admin/settlement"
          icon={Package}
          accent="green"
        />
        <StageCard
          label="모델 파이프라인"
          headline={0}
          sub="추후 P5"
          href="/admin/pipeline"
          icon={GitPullRequest}
          accent="neutral"
        />
      </section>

      {/* 3행: 알림 */}
      <section className="rounded-xl border bg-card">
        <header className="flex items-center gap-2 border-b px-4 py-2.5 text-sm font-semibold">
          <AlertTriangle className="size-4 text-brand-amber" />
          알림
        </header>
        {alerts.length === 0 ? (
          <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-brand-green" />
            모두 정상입니다.
          </div>
        ) : (
          <ul className="space-y-2 p-3">
            {alerts.map((al, i) => (
              <li key={i}>
                <Link
                  href={al.href ?? "#"}
                  className={cn(
                    "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition",
                    al.kind === "warn"
                      ? "border-brand-amber/30 bg-brand-amber/8 hover:bg-brand-amber/15"
                      : "border-brand-blue/25 bg-brand-blue/8 hover:bg-brand-blue/15",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md",
                      al.kind === "warn"
                        ? "bg-brand-amber/25 text-brand-amber-foreground"
                        : "bg-brand-blue/20 text-brand-blue",
                    )}
                  >
                    {al.kind === "warn" ? (
                      <AlertTriangle className="size-3" />
                    ) : (
                      <Info className="size-3" />
                    )}
                  </span>
                  <span className="text-foreground/90">{al.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 4행: 활동 / 이의제기 */}
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-xl border bg-card">
          <header className="flex items-center justify-between border-b px-4 py-2.5">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <ActivityIcon className="size-4 text-brand-amber" />
              최근 이벤트
            </span>
            <span className="text-xs text-muted-foreground">{events.length}건</span>
          </header>
          {events.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              활동이 아직 없습니다.
            </p>
          ) : (
            <ul className="px-4 py-3">
              {events.map((ev, i) => (
                <li key={ev.key} className="relative flex gap-3 pb-3 last:pb-0">
                  <div className="flex flex-col items-center">
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-amber ring-4 ring-brand-amber/15" />
                    {i < events.length - 1 && (
                      <span className="mt-1 w-px flex-1 bg-border" />
                    )}
                  </div>
                  <Link
                    href={ev.href ?? "#"}
                    className="-mt-1 min-w-0 flex-1 rounded-lg px-2 py-1 hover:bg-muted/40"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm">{ev.label}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                        {formatDateTime(ev.ts)}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border bg-card">
          <header className="flex items-center justify-between border-b px-4 py-2.5">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <MessagesSquare className="size-4 text-brand-amber" />
              이의제기 현황
            </span>
            <Link href="/admin/inquiries" className="text-xs underline">
              모두 보기 →
            </Link>
          </header>
          {inquiries.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              제기된 이의가 없습니다.
            </p>
          ) : (
            <ul className="divide-y">
              {inquiries
                .slice()
                .sort((a, b) => b.raisedAt - a.raisedAt)
                .slice(0, 5)
                .map((q) => (
                  <li key={q.id} className="px-4 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        href="/admin/inquiries"
                        className="font-mono text-xs hover:underline"
                      >
                        {q.id.slice(0, 16)}
                      </Link>
                      <span className="text-[10px] text-muted-foreground">
                        {q.status} · {formatRemaining(q.raisedAt + 7 * 86_400_000)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {q.messages[0]?.body}
                    </p>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

const ACCENT_CHIP: Record<string, string> = {
  neutral: "bg-muted text-muted-foreground",
  blue: "bg-brand-blue/15 text-brand-blue",
  green: "bg-brand-green/20 text-brand-green-foreground",
  amber: "bg-brand-amber/20 text-brand-amber-foreground",
};

function StageCard({
  label,
  headline,
  sub,
  href,
  icon: Icon,
  accent = "neutral",
}: {
  label: string;
  headline: number;
  sub: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: "neutral" | "blue" | "green" | "amber";
}) {
  return (
    <Link
      href={href}
      className={cn(
        "block rounded-xl border bg-card p-4 transition hover:border-foreground/30",
        accent === "amber" && headline > 0 && "border-brand-amber/40",
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        <span className={cn("flex size-7 items-center justify-center rounded-lg", ACCENT_CHIP[accent])}>
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{headline}</p>
      <p className="mt-1 text-[10px] text-muted-foreground">{sub}</p>
    </Link>
  );
}
