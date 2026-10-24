"use client";

import { useState } from "react";
import styles from "./usage-view.module.css";

/** 사용 현황 차트 조각 — 직접 SVG(차트 라이브러리 없음). 모두 단일 계열이라 색은 --bar-single 하나. */

export const fmt = (v: number) => v.toLocaleString("ko-KR");
export const shortDay = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
export const kstTime = (ms: number) =>
  new Date(ms).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

/** 가로 막대 목록 — 이름 · 막대 · 값(비율). base 를 주면 비율 분모(퍼널), 없으면 합계 대비. */
export function HBars({ items, base, label }: {
  items: { key: string; label: string; value: number; hint?: string }[];
  base?: number;
  label: string;
}) {
  const total = base ?? items.reduce((a, i) => a + i.value, 0);
  const max = Math.max(1, base ?? 0, ...items.map((i) => i.value));
  return (
    <ul className="flex flex-col gap-2" aria-label={label}>
      {items.map((i) => (
        <li key={i.key} className="grid grid-cols-[minmax(6rem,9rem)_minmax(0,1fr)_5.5rem] items-center gap-3 text-sm" title={i.hint ? `${i.label} — ${i.hint}` : i.label}>
          <span className="truncate">{i.label}</span>
          <span className="h-2.5 rounded-sm bg-muted">
            {i.value > 0 && <span className="block h-full rounded-r-[4px]" style={{ width: `${Math.max(1.5, (i.value / max) * 100)}%`, background: "var(--bar-single)" }} />}
          </span>
          <span className="text-right tabular-nums text-muted-foreground">
            {fmt(i.value)}{total > 0 && <small> ({Math.round((i.value / total) * 100)}%)</small>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** 일별 막대 — 한 번에 한 계열(토글). 막대마다 hover 툴팁, 표 보기 제공. */
export function DailyBars<K extends string>({ daily, series, initial, title }: {
  daily: ({ day: string } & Record<K, number>)[];
  series: { key: K; label: string }[];
  initial: K;
  title: string;
}) {
  const [key, setKey] = useState<K>(initial);
  const [hover, setHover] = useState<number | null>(null);
  const current = series.find((s) => s.key === key) ?? series[0];
  const W = 720, H = 200, top = 8, bottom = 22, left = 32, right = 4;
  const plotH = H - top - bottom, plotW = W - left - right;
  const values = daily.map((d) => Number(d[key] ?? 0));
  const max = Math.max(1, ...values);
  const step = niceStep(max);
  const yMax = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.floor(yMax / step) + 1 }, (_, i) => i * step);
  const slot = plotW / Math.max(1, daily.length);
  const barW = Math.max(2, Math.min(28, slot * 0.7));
  const y = (v: number) => top + plotH - (v / yMax) * plotH;
  const labelEvery = Math.ceil(daily.length / 10);
  const total = values.reduce((a, v) => a + v, 0);

  return (
    <section className={`ds-surface ${styles.chart}`} aria-labelledby="daily-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="daily-title" className="text-sm font-medium">{title} — {current.label}</h2>
        <div className="flex flex-wrap gap-1" role="group" aria-label="계열">
          {series.map((s) => (
            <button key={s.key} type="button" aria-pressed={s.key === key} onClick={() => setKey(s.key)}
              className={`rounded-md border px-2 py-0.5 text-xs ${s.key === key ? "border-foreground/40 bg-muted font-medium" : "text-muted-foreground"}`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {total === 0 ? <Empty>이 기간에 {current.label} 기록이 없어요.</Empty> : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`일별 ${current.label}, 합계 ${total}`} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} strokeDasharray={t === 0 ? undefined : "2 4"} />
                <text x={left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted-foreground)">{t}</text>
              </g>
            ))}
            {daily.map((d, i) => {
              const cx = left + slot * i + slot / 2;
              const v = values[i];
              return (
                <g key={d.day} opacity={hover === null || hover === i ? 1 : 0.55}>
                  {v > 0 && <path d={roundedTop(cx - barW / 2, y(v), barW, y(0) - y(v), 4)} fill="var(--bar-single)" />}
                  {i % labelEvery === 0 && <text x={cx} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--muted-foreground)">{shortDay(d.day)}</text>}
                  <rect x={left + slot * i} y={top} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
                </g>
              );
            })}
          </svg>
          {hover !== null && daily[hover] && (
            <div className={styles.tooltip} style={{ left: `${((left + slot * hover + slot / 2) / W) * 100}%` }} role="status">
              <div className="font-medium">{daily[hover].day}</div>
              {series.map((s) => <div key={s.key} className={s.key === key ? "font-medium" : "text-muted-foreground"}>{s.label} {daily[hover][s.key]}</div>)}
            </div>
          )}
        </div>
      )}
      <details className="ds-disclosure ds-chart-data">
        <summary>표로 보기</summary>
        <table>
          <caption>{title}</caption>
          <thead><tr><th>날짜</th>{series.map((s) => <th key={s.key}>{s.label}</th>)}</tr></thead>
          <tbody>
            {[...daily].reverse().map((d) => <tr key={d.day}><td>{d.day}</td>{series.map((s) => <td key={s.key}>{d[s.key]}</td>)}</tr>)}
          </tbody>
        </table>
      </details>
    </section>
  );
}

function niceStep(max: number): number {
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const r = raw / pow;
  return Math.max(1, (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * pow);
}

/** 윗모서리만 둥근 막대(바닥은 기준선에 붙는다). */
export function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}
