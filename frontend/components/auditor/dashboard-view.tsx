"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  ClipboardList,
  FolderCheck,
  Inbox,
  ListChecks,
  ArrowUpRight,
  ArrowRight,
  Workflow,
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
import { countUnseenResults } from "@/lib/review-lookup";
import { useMailHydrated, useMailStore } from "@/lib/mail-store";
import { useLedgerHydrated, useLedgerStore } from "@/lib/ledger-store";
import { conversations } from "@/lib/load-conversation";
import { MetricCard } from "@/components/design-system/cards";
import { CardHeading, StatusBadge, Surface } from "@/components/design-system/surface";
import { LuminousButton } from "@/components/design-system/controls";
import { isPrototype } from "@/lib/data-mode";
import styles from "./dashboard-view.module.css";
import { middleTruncate } from "@/lib/utils";
import {
  AUDIT_STATUS_LABEL,
  formatDateTime,
} from "@/lib/poc-format";
import { LoadingBlock } from "@/components/ui/spinner";

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
    const unseenResults = countUnseenResults(reviews, audits, auditor.id);
    const unreadMails = myMails.filter((m) => !m.readAt).length;
    return { pickupAvail, drafts, submittedPendingReview, unseenResults, unreadMails };
  }, [tasks, audits, myAudits, reviews, myMails, auditor.id]);

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
      .filter((e) => e.timestamp >= monthStart && e.kind !== "settlement_round")
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
      <LoadingBlock label="로딩 중…" />
    );
  }

  const evaluatedCount = ledgerSummary.accepted + ledgerSummary.rejected;

  return (
    <div className={styles.dashboard}>
      <header className={styles.intro}>
        <div>
          <h1>안녕하세요, {auditor.reviewerName} 님</h1>
          <p className={styles.subtitle}>오늘의 활동과 쌓아 온 기여를 한눈에 살펴보세요.</p>
        </div>
        {isPrototype && <LuminousButton variant="outline" render={<Link href="/audit/agents" />}>
          <Workflow size={16} />내 에이전트 열기<ArrowUpRight size={16} />
        </LuminousButton>}
      </header>

      <section className={styles.overview} aria-label="누적 기여 현황">
        <MetricCard
          title="누적 기여 크레딧"
          value={ledgerSummary.total.toLocaleString()}
          unit="cr"
          description={myEntries.length ? `이번 달 ${ledgerSummary.monthly > 0 ? "+" : ""}${ledgerSummary.monthly.toLocaleString()} cr` : "평가가 인정되면 기여 크레딧이 쌓입니다."}
          footer={<div className={styles.contributionFoot}>
            {ledgerSummary.series.length >= 2 && <div className={styles.trend}>
              <Sparkline data={ledgerSummary.series} width={320} height={42} strokeWidth={2} />
              <span className={styles.srOnly}>잔액 추이: {ledgerSummary.series[0]}에서 {ledgerSummary.total} 크레딧, {ledgerSummary.series.length}개 기록</span>
            </div>}
            <Link href="/audit/ledger" className={styles.textLink}>모델 기여 로그<ArrowUpRight size={16} /></Link>
          </div>}
        />
        <Surface className={styles.acceptance}>
          <CardHeading title="평가 인정률" detail={<StatusBadge tone={evaluatedCount ? "success" : "neutral"}>{evaluatedCount ? "누적 기준" : "집계 전"}</StatusBadge>} />
          <p className={styles.rate}>{evaluatedCount ? `${Math.round(ledgerSummary.acceptanceRate * 100)}%` : "—"}</p>
          {evaluatedCount ? <>
            <div className={styles.meter} aria-hidden="true"><span style={{ width: `${ledgerSummary.acceptanceRate * 100}%` }} /></div>
            <p className={styles.caption}>검수된 {evaluatedCount}건 중 {ledgerSummary.accepted}건 인정</p>
          </> : <p className={styles.caption}>검수 결과가 도착하면<br />나의 평가 인정률을 확인할 수 있어요.</p>}
        </Surface>
      </section>

      <section aria-labelledby="next-actions" className={styles.actionsSection}>
        <div className={styles.sectionHeading}><h2 id="next-actions">지금 할 일</h2><span>작은 참여가 상담의 질을 높입니다.</span></div>
        <div className={styles.stats}>
          <StatCard label="참여 가능한 작업" value={stats.pickupAvail} href="/audit/queue" icon={ClipboardList} detail="새 작업 살펴보기" />
          <StatCard label="진행 중" value={stats.drafts} href="/audit/work" icon={ListChecks} detail="작성 중인 평가" />
          <StatCard label="검수 대기" value={stats.submittedPendingReview} href="/audit/results" icon={FolderCheck} detail={stats.unseenResults ? `새 결과 ${stats.unseenResults}건` : "제출한 평가 확인"} attention={stats.unseenResults > 0} />
          <StatCard label="미확인 우편" value={stats.unreadMails} href="/audit/mailbox" icon={Inbox} detail="우편함 열기" attention={stats.unreadMails > 0} />
        </div>
      </section>

      {stats.drafts > 0 && <Surface className={styles.work}>
        <div className={styles.sectionHeading}><h2>이어서 진행하기</h2><Link href="/audit/work" className={styles.textLink}>모두 보기<ArrowRight size={15} /></Link></div>
        <ul className={styles.workList}>
          {myAudits.filter((a) => a.status === "draft").slice(0, 3).map((a) => <li key={a.id}>
            <Link href={`/audit/work/${a.id}`}>
              <div><p>{conversations[a.conversationId]?.topic.title ?? a.conversationId}</p><span className={styles.caption}>피드백 {a.progress.feedbackCount} · 평가 {a.progress.hasSessionEval ? "완료" : "작성 전"}</span></div>
              <StatusBadge tone="info">{AUDIT_STATUS_LABEL[a.status]}</StatusBadge>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </li>)}
        </ul>
      </Surface>}

      <Surface className={styles.activity}>
        <div className={styles.sectionHeading}><h2>최근 활동</h2><ActivityIcon size={18} aria-hidden="true" /></div>
        {activity.length === 0 ? <div className={styles.emptyActivity}>
          <div><h3>첫 기여를 시작해 보세요</h3><p>상담을 살펴보고 의견을 남기면, 활동 기록이 이곳에 모입니다.</p></div>
          <LuminousButton render={<Link href="/audit/queue" />}>참여할 작업 찾기<ArrowRight size={16} /></LuminousButton>
        </div> : <ul className={styles.timeline}>
          {activity.map((it) => <li key={it.key}>
            <Link href={it.href ?? "/audit/results"}>
              <div><p>{it.label}</p>{it.sub && <span>{it.sub}</span>}</div>
              <time dateTime={new Date(it.ts).toISOString()}>{formatDateTime(it.ts)}</time>
            </Link>
          </li>)}
        </ul>}
      </Surface>
    </div>
  );
}

function StatCard({ label, value, href, icon: Icon, detail, attention = false }: {
  label: string;
  value: number;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  detail: string;
  attention?: boolean;
}) {
  return (
    <Link href={href} className={styles.statLink}>
      <Surface className={styles.stat} tone={attention ? "amber" : "neutral"} material={attention ? "tinted" : "solid"}>
        <div className={styles.statHeading}><h3>{label}</h3><Icon className={styles.statIcon} /></div>
        <p className={styles.statValue}>{value}<span>건</span></p>
        <div className={styles.statFoot}><span>{detail}</span><ArrowUpRight size={16} aria-hidden="true" /></div>
      </Surface>
    </Link>
  );
}
