"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { isPrototype } from "@/lib/data-mode";
import { isOptedOut, setOptOut } from "@/lib/analytics";
import { PROVIDER_LABEL, ROLE_LABEL, type UsageOverview, type UserRole, usageOverview } from "@/services/admin-monitoring";
import {
  type Campaign, type HandoffDemand, KPI_LABEL, type KpiKey, type QuestionStats, type TrafficOverview,
  delta, handoffDemand, listCampaigns, questionStats, rate, sourceLabel, trafficOverview,
} from "@/services/admin-usage";
import { DailyBars, HBars, fmt, kstTime } from "./usage-charts";
import { HandoffPanel } from "./usage-handoff";
import { QuestionFeed, QuestionStatsPanel } from "./usage-questions";
import { CampaignPanel, SourceTable } from "./usage-sources";
import styles from "./usage-view.module.css";

const PERIODS = [{ days: 1, label: "오늘" }, { days: 7, label: "7일" }, { days: 30, label: "30일" }, { days: 90, label: "90일" }] as const;
const KPI_ORDER: KpiKey[] = ["visitors", "sessions", "questions", "signups", "handoffClicks", "connections"];
const CONSULT_LABEL: Record<string, string> = { pending: "대기", accepted: "수락", declined: "거절", completed: "완료", cancelled: "취소" };

interface Loaded { traffic: TrafficOverview; stats: QuestionStats; handoff: HandoffDemand }

/**
 * 사용 현황 2판 (/admin/usage) — 0064 RPC. 위에서 아래로 방문(Q1) → 챗(Q2) → 가입(Q3) → 질문(Q4) → 세무사 연결(Q5),
 * 맨 아래 계정 현황(0049). 기간·경로 필터는 페이지 전체에 걸린다. 날짜는 KST.
 * 설계: design/관리자_사용현황_모니터링_대시보드_설계_1021.md §2.6.
 */
export function UsageView() {
  const [days, setDays] = useState<number>(7);
  const [source, setSource] = useState<string | null>(null);
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [knownSources, setKnownSources] = useState<string[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);

  const load = useCallback(async () => {
    try {
      const [traffic, stats, handoff] = await Promise.all([trafficOverview(days, source), questionStats(days, source), handoffDemand(days, source)]);
      setData({ traffic, stats, handoff });
      if (source === null) setKnownSources(traffic.sources.map((s) => s.source));
      setError(null);
    } catch { setError("사용 현황을 불러오지 못했어요."); }
  }, [days, source]);
  const loadCampaigns = useCallback(async () => {
    try { setCampaigns(await listCampaigns()); } catch { setCampaigns([]); }
  }, []);
  useEffect(() => {
    // 조회 결과를 state 에 담는 마운트·조건 변경 시 조회(kb3-share-view 와 같은 패턴)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!isPrototype) void load();
  }, [load]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!isPrototype) void loadCampaigns(); }, [loadCampaigns]);

  const sourceOptions = [...new Set([...knownSources, ...(campaigns ?? []).map((c) => c.source), ...(source ? [source] : [])])];

  return (
    // 차트 색 변수(--bar-single)를 페이지 전체에 건다 — 섹션 컴포넌트의 막대가 모두 이 색을 쓴다.
    <div className={`flex flex-col gap-5 px-4 py-6 sm:px-6 ${styles.chart}`}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">사용 현황</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            게시 링크 성과 — 방문 → 질문 → 가입 → 세무사 연결. 직원·데모 계정이 로그인한 브라우저는 로그인 전 기록까지 빠집니다. 날짜는 한국 시간.
          </p>
          {!isPrototype && <OptOutLine />}
        </div>
        {!isPrototype && <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1" role="group" aria-label="기간">
            {PERIODS.map((p) => <Button key={p.days} size="sm" variant={days === p.days ? "default" : "outline"} aria-pressed={days === p.days} onClick={() => setDays(p.days)}>{p.label}</Button>)}
          </div>
          <label className="flex items-center gap-1 text-sm">
            <span className="sr-only">경로</span>
            <select className="h-8 rounded-md border bg-background px-2 text-sm" value={source ?? "*"} onChange={(e) => setSource(e.target.value === "*" ? null : e.target.value)}>
              <option value="*">모든 경로</option>
              {sourceOptions.map((s) => <option key={s} value={s}>{sourceLabel(s)}</option>)}
            </select>
          </label>
        </div>}
      </header>
      {isPrototype ? <p className="text-muted-foreground">사용 현황은 운영 데이터에서만 볼 수 있어요.</p>
        : error ? <p role="alert" className="text-sm text-destructive">{error}</p>
        : data === null ? <p role="status" className="text-muted-foreground">불러오는 중…</p>
        : <>
          {source && <p className="text-sm">
            <b>{sourceLabel(source)}</b> 경로만 보는 중 · <button type="button" className="underline underline-offset-4" onClick={() => setSource(null)}>모든 경로</button>
          </p>}
          <Kpis traffic={data.traffic} />
          <Funnel traffic={data.traffic} />
          {source === null && <SourceTable sources={data.traffic.sources} onFilter={setSource} />}
          <DailyBars title="일별 추이" daily={data.traffic.daily} initial="visitors" series={[
            { key: "visitors", label: "방문자" }, { key: "sessions", label: "채팅 세션" }, { key: "questions", label: "질문" },
            { key: "signups", label: "가입" }, { key: "clicks", label: "연결 클릭" }, { key: "connections", label: "연결 성립" },
          ]} />
          <QuestionStatsPanel stats={data.stats} />
          <QuestionFeed days={days} source={source} topics={Object.keys(data.stats.byTopic).sort()} />
          <HandoffPanel data={data.handoff} />
          <CampaignPanel campaigns={campaigns} onSaved={() => { void loadCampaigns(); void load(); }} />
          <AccountStatus days={days} />
        </>}
    </div>
  );
}

function Kpis({ traffic }: { traffic: TrafficOverview }) {
  const { kpi, prev, days } = traffic;
  const prevLabel = days === 1 ? "어제" : `직전 ${days}일`;
  return <>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>{days === 1 ? "오늘" : `최근 ${days}일`} · {prevLabel} 대비</span>
      <span className="flex items-center gap-1.5" title="최근 10분 안에 활동한 방문자">
        <span className={`inline-block size-2 rounded-full ${traffic.liveNow > 0 ? "bg-emerald-500" : "bg-muted-foreground/40"}`} aria-hidden />
        지금 접속 중 {fmt(traffic.liveNow)}
      </span>
    </div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {KPI_ORDER.map((k) => {
        const d = delta(kpi[k], prev[k]);
        const line = d.diff === 0 ? `${prevLabel}과 같음` : d.pct === null ? `${prevLabel} 0 → 새로 ${fmt(d.diff)}` : `${d.diff > 0 ? "▲" : "▼"} ${fmt(Math.abs(d.diff))} (${d.pct > 0 ? "+" : ""}${d.pct}%)`;
        return (
          <section key={k} className="ds-surface flex flex-col gap-1">
            <h2 className="text-xs text-muted-foreground">{KPI_LABEL[k]}</h2>
            <p className="text-2xl font-semibold tabular-nums">{fmt(kpi[k])}</p>
            <p className="text-[11px] text-muted-foreground" aria-label={`${prevLabel} ${prev[k]}`}>{line}</p>
          </section>
        );
      })}
    </div>
    {kpi.visitors === 0 && (
      <p className="ds-surface text-sm text-muted-foreground">
        이 기간에 집계할 방문이 아직 없어요.
        {traffic.trackingSince ? ` 방문 기록은 ${kstTime(traffic.trackingSince)}부터 쌓이고 있어요.` : " 방문 기록이 아직 하나도 없어요."}
        {" "}아래 &quot;게시 코드&quot;에서 링크를 만들어 커뮤니티 글에 붙이면 경로별로 나타납니다. 관리자로 로그인한 이 브라우저의 방문은 세지 않습니다.
      </p>
    )}
    {traffic.unattributedTurns > 0 && (
      <p className="text-xs text-muted-foreground">
        방문 기록과 잇지 못한 고객 챗 질문 {fmt(traffic.unattributedTurns)}개는 위 숫자에서 뺐어요 — 팀 브라우저(집계 제외)·자동 평가·방문 기록 시작(10/21) 전 대화입니다.
      </p>
    )}
  </>;
}

function Funnel({ traffic }: { traffic: TrafficOverview }) {
  const f = traffic.funnel;
  const signup = rate(f.signedUp, f.visitors);
  return (
    <section className={`ds-surface ${styles.chart}`} aria-labelledby="funnel-title">
      <h2 id="funnel-title" className="mb-1 text-sm font-medium">퍼널 (방문자 단위)</h2>
      <p className="mb-3 text-xs text-muted-foreground">괄호 = 방문자 대비. 같은 브라우저는 한 명으로 셉니다.</p>
      {f.visitors === 0 ? <p className="text-sm text-muted-foreground">방문자가 생기면 단계별 전환이 여기에 나옵니다.</p> : <>
        <HBars label="방문 퍼널" base={f.visitors} items={[
          { key: "visitors", label: "방문", value: f.visitors },
          { key: "asked", label: "질문함", value: f.asked },
          { key: "shown", label: "세무사 카드 봄", value: f.shown },
          { key: "clicked", label: "연결 클릭", value: f.clicked },
          { key: "connected", label: "연결 성립", value: f.connected },
        ]} />
        <p className="mt-3 text-sm">방문 → 가입: <b className="tabular-nums">{fmt(f.signedUp)}</b>명{signup !== null && <span className="text-muted-foreground"> ({signup}%)</span>}</p>
      </>}
    </section>
  );
}

/** 계정 현황 — 0049 admin_usage_overview(전체 사용자·역할·가입 경로·상담 신청 상태). 방문 집계와 달리 계정 기준. */
function AccountStatus({ days }: { days: number }) {
  const [data, setData] = useState<UsageOverview | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    usageOverview(Math.max(days, 7)).then((d) => alive && setData(d)).catch(() => alive && setError(true));
    return () => { alive = false; };
  }, [days]);
  if (error) return <p role="alert" className="text-sm text-destructive">계정 현황을 불러오지 못했어요.</p>;
  if (!data) return null;
  const { users } = data;
  const roleLine = (["user", "auditor", "admin"] as UserRole[]).map((r) => `${ROLE_LABEL[r]} ${users.byRole[r] ?? 0}`).join(" · ");
  const providers = Object.entries(users.byProvider).sort((a, b) => b[1] - a[1]);
  const consults = Object.entries(data.consultations);
  return (
    <section className="ds-surface" aria-labelledby="accounts-title">
      <h2 id="accounts-title" className="mb-3 text-sm font-medium">계정 현황 <small className="font-normal text-muted-foreground">(데모·직원 계정 포함)</small></h2>
      <div className="grid gap-4 text-sm sm:grid-cols-3">
        <div><p className="text-2xl font-semibold tabular-nums">{fmt(users.total)}</p><p className="text-xs text-muted-foreground">전체 계정 · {roleLine}</p></div>
        <div><p className="text-2xl font-semibold tabular-nums">{fmt(users.active7d)}</p><p className="text-xs text-muted-foreground">최근 7일 로그인 · 30일 {users.active30d}명 · 최근 {data.days}일 신규 {users.newInPeriod}명</p></div>
        <div>
          <p className="text-xs text-muted-foreground">상담 신청 (최근 {data.days}일)</p>
          <p>{consults.length ? consults.map(([s, n]) => `${CONSULT_LABEL[s] ?? s} ${n}`).join(" · ") : "없음"}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            세무사 가입 신청 대기: {data.pendingApplications > 0
              ? <Link href="/admin/applications" className="font-medium text-foreground underline underline-offset-4">{data.pendingApplications}건</Link>
              : "없음"}
          </p>
        </div>
      </div>
      {providers.length > 0 && <div className={`mt-4 ${styles.chart}`}>
        <h3 className="mb-2 text-xs font-medium text-muted-foreground">가입 경로(로그인 수단)</h3>
        <HBars label="로그인 수단" items={providers.map(([p, n]) => ({ key: p, label: PROVIDER_LABEL[p] ?? p, value: n }))} />
      </div>}
    </section>
  );
}

/** 이 브라우저의 방문을 사용 현황에서 뺄지(관리자 로그인 시 자동으로 빠진다). 팀원 휴대폰은 주소 뒤에 ?nl_optout=1. */
function OptOutLine() {
  const [out, setOut] = useState<boolean | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setOut(isOptedOut()), []);
  if (out === null) return null;
  return <p className="mt-1 text-xs text-muted-foreground">
    이 브라우저 방문은 {out ? "집계에서 빠져 있어요." : "집계에 포함돼요."}{" "}
    <button type="button" className="underline underline-offset-2" onClick={() => { setOptOut(!out); setOut(!out); }}>{out ? "다시 포함" : "집계에서 빼기"}</button>
  </p>;
}
