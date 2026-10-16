"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  Inbox,
  ListChecks,
  ArrowUpRight,
  ArrowRight,
  Workflow,
  Handshake,
  MessageCircle,
  Activity as ActivityIcon,
} from "lucide-react";
import { Sparkline } from "@/components/ui/sparkline";
import { useAccountHydrated, useAccountStore } from "@/lib/account-store";
import { useMailHydrated, useMailStore } from "@/lib/mail-store";
import { useLedgerHydrated, useLedgerStore } from "@/lib/ledger-store";
import { MetricCard } from "@/components/design-system/cards";
import { CardHeading, StatusBadge, Surface } from "@/components/design-system/surface";
import { LuminousButton } from "@/components/design-system/controls";
import { agentStudioEnabled } from "@/lib/data-mode";
import { useConsultationHydrated, useConsultationStore } from "@/lib/consultation-store";
import { useAuditorSidebarBadges } from "@/lib/sidebar-badges";
import styles from "./dashboard-view.module.css";
import { formatDateTime } from "@/lib/poc-format";
import { LoadingBlock } from "@/components/ui/spinner";

/**
 * 세무사 대시보드 최소판(옛 검수 흐름 절단 S1 · D8) — 나의 상담·우편함·기여 내역 합계.
 * 옛 일감·검수·인정률 카드는 뺐다(design/옛검수흐름_절단_로드맵_1016.md). 옛 검수 기여 행은 원장에 남아
 * 누적 크레딧에는 그대로 들어간다(append-only).
 */
export function DashboardView() {
  const accountHydrated = useAccountHydrated();
  const mailHydrated = useMailHydrated();
  const ledgerHydrated = useLedgerHydrated();

  const auditor = useAccountStore((s) => s.auditor);
  const mails = useMailStore((s) => s.mails);
  const ledgerEntries = useLedgerStore((s) => s.entries);
  const consultations = useConsultationStore((s) => s.requests);
  const consultationsHydrated = useConsultationHydrated();
  const { roomsUnread } = useAuditorSidebarBadges();

  const myMails = useMemo(
    () => mails.filter((m) => m.recipientId === auditor.id),
    [mails, auditor.id],
  );
  const myEntries = useMemo(
    () => ledgerEntries.filter((e) => e.auditorId === auditor.id),
    [ledgerEntries, auditor.id],
  );

  const myConsultations = useMemo(() => {
    const mine = consultations.filter((c) => c.expertId === auditor.id);
    return { pending: mine.filter((c) => c.status === "pending").length, accepted: mine.filter((c) => c.status === "accepted").length };
  }, [consultations, auditor.id]);

  const unreadMails = myMails.filter((m) => !m.readAt).length;

  const ledgerSummary = useMemo(() => {
    const sorted = myEntries.slice().sort((a, b) => a.timestamp - b.timestamp);
    const total = sorted.at(-1)?.balanceAfter ?? 0;
    const series = sorted.map((e) => e.balanceAfter);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const monthly = myEntries
      .filter((e) => e.timestamp >= monthStart && e.kind !== "settlement_round")
      .reduce((a, e) => a + e.amount, 0);
    // 공용 KB 에 지금 반영돼 있는 내 사례 수 = 반영 − 철회(0056 kb3_share).
    let shared = 0;
    for (const e of myEntries) {
      if (e.sourceRef.kind !== "kb3_share") continue;
      shared += e.sourceRef.event === "approved" ? 1 : -1;
    }
    return { total, monthly, series, shared: Math.max(0, shared) };
  }, [myEntries]);

  const activity = useMemo(() => {
    type Item = { ts: number; label: string; href: string; key: string };
    const items: Item[] = [];
    for (const m of myMails.slice(-10)) {
      items.push({ ts: m.sentAt, label: `우편: "${m.subject}"`, href: "/audit/mailbox", key: `mail-${m.id}` });
    }
    for (const e of myEntries) {
      if (e.sourceRef.kind !== "kb3_share") continue;
      items.push({
        ts: e.timestamp,
        label: `공용 KB 사례 ${e.sourceRef.event === "approved" ? "반영" : "철회"} · ${e.sourceRef.title} (${e.amount > 0 ? "+" : ""}${e.amount} cr)`,
        href: "/audit/ledger",
        key: `ledger-${e.id}`,
      });
    }
    return items.sort((a, b) => b.ts - a.ts).slice(0, 8);
  }, [myMails, myEntries]);

  if (!accountHydrated || !mailHydrated || !ledgerHydrated) {
    return (
      <LoadingBlock label="로딩 중…" />
    );
  }

  return (
    <div className={styles.dashboard}>
      <header className={styles.intro}>
        <div>
          <h1>안녕하세요, {auditor.reviewerName} 님</h1>
          <p className={styles.subtitle}>나의 상담과 쌓아 온 기여를 한눈에 살펴보세요.</p>
        </div>
        {agentStudioEnabled && <LuminousButton variant="outline" render={<Link href="/audit/agents" />}>
          <Workflow size={16} />내 에이전트 열기<ArrowUpRight size={16} />
        </LuminousButton>}
      </header>

      <section className={styles.overview} aria-label="누적 기여 현황">
        <MetricCard
          title="누적 기여 크레딧"
          value={ledgerSummary.total.toLocaleString()}
          unit="cr"
          description={myEntries.length ? `이번 달 ${ledgerSummary.monthly > 0 ? "+" : ""}${ledgerSummary.monthly.toLocaleString()} cr` : "가르친 사례가 공용 KB 에 반영되면 기여 크레딧이 쌓입니다."}
          footer={<div className={styles.contributionFoot}>
            {ledgerSummary.series.length >= 2 && <div className={styles.trend}>
              <Sparkline data={ledgerSummary.series} width={320} height={42} strokeWidth={2} />
              <span className={styles.srOnly}>잔액 추이: {ledgerSummary.series[0]}에서 {ledgerSummary.total} 크레딧, {ledgerSummary.series.length}개 기록</span>
            </div>}
            <Link href="/audit/ledger" className={styles.textLink}>기여 내역<ArrowUpRight size={16} /></Link>
          </div>}
        />
        <Surface className={styles.acceptance}>
          <CardHeading title="공용 KB 반영 사례" detail={<StatusBadge tone={ledgerSummary.shared ? "success" : "neutral"}>{ledgerSummary.shared ? "반영 중" : "아직 없음"}</StatusBadge>} />
          <p className={styles.rate}>{ledgerSummary.shared}건</p>
          <p className={styles.caption}>가르친 사례를 공용 KB 에 공유하고<br />관리자가 승인하면 여기에 셉니다.</p>
        </Surface>
      </section>

      <section aria-labelledby="my-consultations" className={styles.actionsSection}>
        <div className={styles.sectionHeading}><h2 id="my-consultations">나의 상담</h2><span>고객이 신청한 상담과 진행 중인 대화입니다.</span></div>
        <div className={styles.stats}>
          <StatCard label="새 상담 신청" value={consultationsHydrated ? myConsultations.pending : 0} href="/audit/consultations" icon={Handshake} detail={consultationsHydrated ? "신청 확인하기" : "불러오는 중…"} attention={myConsultations.pending > 0} />
          <StatCard label="진행 중인 상담" value={consultationsHydrated ? myConsultations.accepted : 0} href="/audit/consultations" icon={ListChecks} detail="수락한 상담 살펴보기" />
          <StatCard label="안 읽은 채팅" value={roomsUnread ?? 0} href="/audit/rooms" icon={MessageCircle} detail="채팅방 열기" attention={(roomsUnread ?? 0) > 0} />
          <StatCard label="미확인 우편" value={unreadMails} href="/audit/mailbox" icon={Inbox} detail="우편함 열기" attention={unreadMails > 0} />
        </div>
      </section>

      <Surface className={styles.activity}>
        <div className={styles.sectionHeading}><h2>최근 활동</h2><ActivityIcon size={18} aria-hidden="true" /></div>
        {activity.length === 0 ? <div className={styles.emptyActivity}>
          <div><h3>아직 활동 기록이 없어요</h3><p>상담 신청을 받거나 사례가 공용 KB 에 반영되면, 활동 기록이 이곳에 모입니다.</p></div>
          <LuminousButton render={<Link href="/audit/consultations" />}>상담 신청 보기<ArrowRight size={16} /></LuminousButton>
        </div> : <ul className={styles.timeline}>
          {activity.map((it) => <li key={it.key}>
            <Link href={it.href}>
              <div><p>{it.label}</p></div>
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
