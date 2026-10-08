"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { isPrototype } from "@/lib/data-mode";
import { PROVIDER_LABEL, ROLE_LABEL, type UsageDay, type UsageOverview, type UserRole, usageOverview } from "@/services/admin-monitoring";
import styles from "./usage-view.module.css";

const PERIODS = [7, 30, 90] as const;

/** chat_turns.outcome → 화면 이름. */
const OUTCOME_LABEL: Record<string, string> = {
  verdict: "판정 답변",
  advisory: "자문형 답변",
  undecided: "판정 보류",
  no_precedent: "근거 없음",
  missing_inputs: "되묻기",
  off_issue: "쟁점 밖",
  handoff_request: "세무사 연결 요청",
  unsupported_occupation: "미지원 업종",
  unknown: "기타",
};
const CONSULT_LABEL: Record<string, string> = { pending: "대기", accepted: "수락", declined: "거절", completed: "완료", cancelled: "취소" };

/**
 * 사용 현황 (/admin/usage) — admin_usage_overview(0049). 날짜는 KST.
 * 비회원 턴 = 서버에 대화가 없는 챗 턴(비회원 대화는 저장하지 않는다). 방문 수(PV)는 수집하지 않는다.
 */
export function UsageView() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<UsageOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await usageOverview(days)); setError(null); }
    catch { setError("사용 현황을 불러오지 못했어요."); }
  }, [days]);
  useEffect(() => {
    // 조회 결과를 state 에 담는 마운트·조건 변경 시 조회(kb3-share-view 와 같은 패턴)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!isPrototype) void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-5 px-6 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">사용 현황</h1>
          <p className="mt-1 text-sm text-muted-foreground">회원·가입 경로·챗 사용량. 날짜는 한국 시간 기준입니다.</p>
        </div>
        {!isPrototype && <div className="flex gap-2" role="group" aria-label="기간">
          {PERIODS.map((p) => <Button key={p} size="sm" variant={days === p ? "default" : "outline"} aria-pressed={days === p} onClick={() => setDays(p)}>최근 {p}일</Button>)}
        </div>}
      </header>
      {isPrototype ? <p className="text-muted-foreground">사용 현황은 운영 데이터에서만 볼 수 있어요.</p>
        : error ? <p role="alert" className="text-sm text-destructive">{error}</p>
        : data === null ? <p role="status" className="text-muted-foreground">불러오는 중…</p>
        : <Overview data={data} />}
    </div>
  );
}

function Overview({ data }: { data: UsageOverview }) {
  const { users, turns } = data;
  const roleLine = (["user", "auditor", "admin"] as UserRole[]).map((r) => `${ROLE_LABEL[r]} ${users.byRole[r] ?? 0}`).join(" · ");
  const providerLine = Object.entries(users.byProvider).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${PROVIDER_LABEL[p] ?? p} ${n}`).join(" · ") || "—";
  const consultTotal = Object.values(data.consultations).reduce((a, b) => a + b, 0);
  const consultLine = Object.entries(data.consultations).map(([s, n]) => `${CONSULT_LABEL[s] ?? s} ${n}`).join(" · ") || "없음";

  return <>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="전체 사용자" value={users.total} sub={roleLine} />
      <Stat label="최근 7일 로그인" value={users.active7d} sub={`30일 ${users.active30d}명 · 기간 내 신규 가입 ${users.newInPeriod}명`} />
      <Stat label={`챗 턴 (${data.days}일)`} value={turns.member + turns.guest} sub={`회원 ${turns.member} · 비회원 ${turns.guest}`} />
      <Stat label={`상담 신청 (${data.days}일)`} value={consultTotal} sub={consultLine} />
    </div>
    <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
      <span>가입 경로: {providerLine}</span>
      <span>
        세무사 가입 신청 대기: {data.pendingApplications > 0
          ? <Link href="/admin/applications" className="font-medium text-foreground underline underline-offset-4">{data.pendingApplications}건</Link>
          : "없음"}
      </span>
    </div>
    <TurnsChart daily={data.daily} />
    <OutcomeBars byOutcome={turns.byOutcome} />
  </>;
}

function Stat({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <section className="ds-surface flex flex-col gap-1">
      <h2 className="text-sm text-muted-foreground">{label}</h2>
      <p className="text-3xl font-semibold tabular-nums">{value.toLocaleString("ko-KR")}</p>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </section>
  );
}

const shortDay = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;

/** 일별 챗 턴 — 회원(아래)·비회원(위) 누적 막대. 막대마다 hover 툴팁, 표 보기 제공. */
function TurnsChart({ daily }: { daily: UsageDay[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = 200, top = 8, bottom = 22, left = 32, right = 4;
  const plotH = H - top - bottom, plotW = W - left - right;
  const max = Math.max(1, ...daily.map((d) => d.memberTurns + d.guestTurns));
  const step = niceStep(max);
  const yMax = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.floor(yMax / step) + 1 }, (_, i) => i * step);
  const slot = plotW / daily.length;
  const barW = Math.max(2, Math.min(28, slot * 0.7));
  const y = (v: number) => top + plotH - (v / yMax) * plotH;
  const labelEvery = Math.ceil(daily.length / 10);
  const total = daily.reduce((a, d) => a + d.memberTurns + d.guestTurns, 0);
  const hovered = hover !== null ? daily[hover] : null;

  return (
    <section className={`ds-surface ${styles.chart}`} aria-labelledby="turns-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="turns-title" className="text-sm font-medium">일별 챗 턴</h2>
        <ul className="flex gap-4 text-xs text-muted-foreground" aria-label="범례">
          <li className="flex items-center gap-1.5"><span className={styles.swatch} style={{ background: "var(--series-member)" }} />회원</li>
          <li className="flex items-center gap-1.5"><span className={styles.swatch} style={{ background: "var(--series-guest)" }} />비회원</li>
        </ul>
      </div>
      {total === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">이 기간에 챗 사용이 없어요.</p> : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`최근 ${daily.length}일 일별 챗 턴, 합계 ${total}`} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} strokeDasharray={t === 0 ? undefined : "2 4"} />
                <text x={left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted-foreground)">{t}</text>
              </g>
            ))}
            {daily.map((d, i) => {
              const cx = left + slot * i + slot / 2;
              const x = cx - barW / 2;
              const m = d.memberTurns, g = d.guestTurns;
              const yM = y(m), yT = y(m + g);
              const gap = m > 0 && g > 0 ? 2 : 0;
              return (
                <g key={d.day} opacity={hover === null || hover === i ? 1 : 0.55}>
                  {m > 0 && <path d={roundedTop(x, yM, barW, y(0) - yM, g > 0 ? 0 : 4)} fill="var(--series-member)" />}
                  {g > 0 && <path d={roundedTop(x, yT, barW, Math.max(0, yM - yT - gap), 4)} fill="var(--series-guest)" />}
                  {i % labelEvery === 0 && <text x={cx} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--muted-foreground)">{shortDay(d.day)}</text>}
                  <rect x={left + slot * i} y={top} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
                </g>
              );
            })}
          </svg>
          {hovered && hover !== null && (
            <div className={styles.tooltip} style={{ left: `${((left + slot * hover + slot / 2) / W) * 100}%` }} role="status">
              <div className="font-medium">{hovered.day}</div>
              <div className="flex items-center gap-1.5"><span className={styles.swatch} style={{ background: "var(--series-member)" }} />회원 {hovered.memberTurns}</div>
              <div className="flex items-center gap-1.5"><span className={styles.swatch} style={{ background: "var(--series-guest)" }} />비회원 {hovered.guestTurns}</div>
              <div className="text-muted-foreground">가입 {hovered.signups} · 새 회원 대화 {hovered.conversations}</div>
            </div>
          )}
        </div>
      )}
      <details className="ds-disclosure ds-chart-data">
        <summary>표로 보기</summary>
        <table>
          <caption>일별 가입·대화·챗 턴</caption>
          <thead><tr><th>날짜</th><th>가입</th><th>새 회원 대화</th><th>회원 턴</th><th>비회원 턴</th></tr></thead>
          <tbody>
            {[...daily].reverse().map((d) => (
              <tr key={d.day}><td>{d.day}</td><td>{d.signups}</td><td>{d.conversations}</td><td>{d.memberTurns}</td><td>{d.guestTurns}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
      <p className="mt-3 text-xs text-muted-foreground">비회원 턴은 서버에 대화가 저장되지 않는 챗(로그인 전 방문자)입니다. 방문 수는 수집하지 않습니다.</p>
    </section>
  );
}

/** 처리 결과 분포 — 단일 계열 가로 막대, 값 직접 표시. */
function OutcomeBars({ byOutcome }: { byOutcome: Record<string, number> }) {
  const entries = Object.entries(byOutcome).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((a, [, n]) => a + n, 0);
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return (
    <section className={`ds-surface ${styles.chart}`} aria-labelledby="outcome-title">
      <h2 id="outcome-title" className="mb-3 text-sm font-medium">답변 처리 결과</h2>
      {total === 0 ? <p className="text-sm text-muted-foreground">이 기간에 기록이 없어요.</p> : (
        <ul className="flex flex-col gap-2">
          {entries.map(([k, n]) => (
            <li key={k} className="grid grid-cols-[7.5rem_minmax(0,1fr)_4.5rem] items-center gap-3 text-sm" title={`${OUTCOME_LABEL[k] ?? k}: ${n}건`}>
              <span className="truncate">{OUTCOME_LABEL[k] ?? k}</span>
              <span className="h-2.5 rounded-sm bg-muted">
                <span className="block h-full rounded-r-[4px]" style={{ width: `${(n / max) * 100}%`, background: "var(--bar-single)" }} />
              </span>
              <span className="text-right tabular-nums text-muted-foreground">{n} <small>({Math.round((n / total) * 100)}%)</small></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function niceStep(max: number): number {
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow);
}

/** 윗모서리만 둥근 막대(바닥은 기준선에 붙는다). */
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}
