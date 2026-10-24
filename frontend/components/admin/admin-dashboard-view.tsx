"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BadgeCheck, Footprints, Handshake, MessageSquare, MousePointerClick, Share2, UserPlus } from "lucide-react";
import { useConsultationHydrated, useConsultationStore } from "@/lib/consultation-store";
import { useAccountStore } from "@/lib/account-store";
import { isPrototype } from "@/lib/data-mode";
import { cn } from "@/lib/utils";
import { usageOverview, type UsageOverview } from "@/services/admin-monitoring";
import { type KpiKey, type TrafficOverview, delta, trafficOverview } from "@/services/admin-usage";
import { listShareQueue } from "@/services/expert-kb3";

/**
 * 관리자 대시보드 최소판(옛 검수 흐름 절단 S1 · D8) — 상담 신청·가입 신청·사용자·사용 현황·공용 KB 승인 대기.
 * 옛 후보 풀·Task·검수·이의제기·정산 카드는 뺐다(design/옛검수흐름_절단_로드맵_1016.md).
 * 숫자는 0049 admin_usage_overview(가입 신청 대기) · 0064 admin_traffic_overview(최근 7일 방문 KPI) · 공용 KB 승인 대기 목록을 한 번씩 부른다.
 */
export function AdminDashboardView() {
  const adminName = useAccountStore((s) => s.admin.operatorName);
  const consultHydrated = useConsultationHydrated();
  const consultPending = useConsultationStore(
    (s) => s.requests.filter((r) => r.status === "pending").length,
  );
  const consultAccepted = useConsultationStore(
    (s) => s.requests.filter((r) => r.status === "accepted").length,
  );

  const [usage, setUsage] = useState<UsageOverview | null>(null);
  const [usageError, setUsageError] = useState(false);
  const [traffic, setTraffic] = useState<TrafficOverview | null>(null);
  const [trafficError, setTrafficError] = useState(false);
  const [sharePending, setSharePending] = useState<number | null>(null);
  const [shareError, setShareError] = useState(false);

  useEffect(() => {
    if (isPrototype) return;
    let alive = true;
    usageOverview(7)
      .then((u) => alive && setUsage(u))
      .catch(() => alive && setUsageError(true));
    trafficOverview(7)
      .then((t) => alive && setTraffic(t))
      .catch(() => alive && setTrafficError(true));
    listShareQueue("pending")
      .then((items) => alive && setSharePending(items.length))
      .catch(() => alive && setShareError(true));
    return () => {
      alive = false;
    };
  }, []);

  const live = (value: number | undefined, error: boolean) =>
    isPrototype ? "—" : error ? "!" : value === undefined ? "…" : value;

  // 사용 현황 2판 KPI 6칸 중 4칸(설계 1021 §2.6). 직전 7일 대비.
  const kpiSub = (k: KpiKey, unit: string) => {
    if (!traffic) return unit;
    const d = delta(traffic.kpi[k], traffic.prev[k]);
    return d.diff === 0 ? "직전 7일과 같음" : `직전 7일 대비 ${d.diff > 0 ? "▲" : "▼"} ${Math.abs(d.diff)}${d.pct === null ? "" : ` (${d.pct > 0 ? "+" : ""}${d.pct}%)`}`;
  };

  return (
    <div className="ds-page flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">대시보드</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {adminName} · 처리할 일과 최근 7일 사용 현황.
          {isPrototype && " 숫자는 운영 데이터에서만 보입니다."}
        </p>
      </header>

      <section aria-labelledby="todo" className="flex flex-col gap-3">
        <h2 id="todo" className="text-sm font-semibold">처리할 일</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard
            label="상담 신청 대기"
            headline={consultHydrated ? consultPending : "…"}
            sub={consultHydrated ? `진행 중 ${consultAccepted}` : "불러오는 중"}
            href="/admin/consultations"
            icon={Handshake}
            attention={consultPending > 0}
          />
          <StatCard
            label="세무사 가입 신청"
            headline={live(usage?.pendingApplications, usageError)}
            sub="검토 대기"
            href="/admin/applications"
            icon={BadgeCheck}
            attention={(usage?.pendingApplications ?? 0) > 0}
          />
          <StatCard
            label="공용 KB 승인 대기"
            headline={live(sharePending ?? undefined, shareError)}
            sub="세무사가 공유한 사례"
            href="/admin/pipeline/kb3-share"
            icon={Share2}
            attention={(sharePending ?? 0) > 0}
          />
        </div>
      </section>

      <section aria-labelledby="usage" className="flex flex-col gap-3">
        <h2 id="usage" className="text-sm font-semibold">사용 현황 (최근 7일)</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="방문자" headline={live(traffic?.kpi.visitors, trafficError)} sub={kpiSub("visitors", "직원·데모 브라우저 제외")} href="/admin/usage" icon={Footprints} />
          <StatCard label="채팅 세션" headline={live(traffic?.kpi.sessions, trafficError)} sub={kpiSub("sessions", "첫 질문을 보낸 대화")} href="/admin/usage" icon={MessageSquare} />
          <StatCard label="신규 사장님 가입" headline={live(traffic?.kpi.signups, trafficError)} sub={kpiSub("signups", "방문 기록과 이어진 가입")} href="/admin/usage" icon={UserPlus} />
          <StatCard label="세무사 연결 클릭" headline={live(traffic?.kpi.handoffClicks, trafficError)} sub={kpiSub("handoffClicks", "연결·신청 버튼")} href="/admin/usage" icon={MousePointerClick} />
        </div>
        {!isPrototype && (usageError || trafficError || shareError) && (
          <p role="alert" className="text-xs text-destructive">
            일부 숫자를 불러오지 못했습니다(! 표시). 각 화면에서 다시 확인해 주세요.
          </p>
        )}
      </section>
    </div>
  );
}

function StatCard({
  label,
  headline,
  sub,
  href,
  icon: Icon,
  attention = false,
}: {
  label: string;
  headline: number | string;
  sub: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  attention?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "block ds-panel p-4 transition hover:border-foreground/30",
        attention && "border-brand-amber/40",
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        <span
          className={cn(
            "flex size-7 items-center justify-center rounded-lg",
            attention ? "bg-brand-amber/20 text-brand-amber-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{headline}</p>
      <p className="mt-1 text-[10px] text-muted-foreground">{sub}</p>
    </Link>
  );
}
