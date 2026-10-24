"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { type OutcomeGroup, OUTCOME_GROUPS, groupOutcomes, outcomeLabel, outcomesOf } from "@/lib/outcome-groups";
import { type QuestionRow, type QuestionStats, questionFeed, sourceLabel } from "@/services/admin-usage";
import { Empty, HBars, fmt, kstTime } from "./usage-charts";

const PAGE = 30;

/** 질문 분석 — 답변 결과 묶음 · 세목 · 질문 유형 분포. 원값 묶음표는 lib/outcome-groups.ts. */
export function QuestionStatsPanel({ stats }: { stats: QuestionStats }) {
  const groups = groupOutcomes(stats.byOutcome);
  const dist = (rec: Record<string, number>) =>
    Object.entries(rec).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ key: k || "none", label: k || "분류 없음", value: n }));
  const per = ["1", "2", "3", "4", "5"].map((k) => `${k === "5" ? "5개 이상" : `${k}개`} ${stats.perSession[k] ?? 0}`).join(" · ");

  return (
    <section className="ds-surface" aria-labelledby="questions-title">
      <h2 id="questions-title" className="mb-1 text-sm font-medium">질문 분석</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        고객 챗 질문 {fmt(stats.total)}개 · 채팅 세션 {fmt(stats.sessions)}개{stats.total > 0 && ` · 세션당 질문 수: ${per}`}
      </p>
      {stats.total === 0 ? <Empty>이 기간에 방문 기록과 이어진 고객 질문이 없어요.</Empty> : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div>
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">답변 결과</h3>
            <HBars label="답변 결과 묶음" items={groups.filter((g) => g.count > 0).map((g) => ({
              key: g.key, label: g.label, value: g.count,
              hint: g.outcomes.map(([k, n]) => `${outcomeLabel(k)} ${n}`).join(", "),
            }))} />
          </div>
          <div>
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">세목</h3>
            <HBars label="세목 분포" items={dist(stats.byTopic)} />
          </div>
          <div>
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">질문 유형</h3>
            <HBars label="질문 유형 분포" items={dist(stats.byType)} />
          </div>
        </div>
      )}
      {stats.unclassified > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          &quot;분류 없음&quot; {fmt(stats.unclassified)}개는 세목·유형 기록을 시작하기 전(10/24 정오 전) 질문이거나, 되묻기처럼 분류 없이 끝난 턴입니다.
        </p>
      )}
    </section>
  );
}

/** 최근 질문 목록 — 식별정보를 가린 원문(90일 보관). 세목·결과로 거른다. */
export function QuestionFeed({ days, source, topics }: { days: number; source: string | null; topics: string[] }) {
  const [topic, setTopic] = useState<string | null>(null);
  const [group, setGroup] = useState<OutcomeGroup | null>(null);
  const [rows, setRows] = useState<QuestionRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState(false);

  const load = useCallback(async (offset: number) => {
    try {
      const res = await questionFeed({ days, source, topic, outcomes: group ? outcomesOf(group) : null, limit: PAGE, offset });
      setRows((prev) => (offset === 0 ? res.rows : [...(prev ?? []), ...res.rows]));
      setTotal(res.total);
      setError(false);
    } catch { setError(true); }
  }, [days, source, topic, group]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setRows(null); void load(0); }, [load]);

  return (
    <section className="ds-surface" aria-labelledby="feed-title">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="feed-title" className="text-sm font-medium">최근 질문</h2>
          <p className="text-xs text-muted-foreground">전화·이메일·주민·사업자·계좌번호는 [가림]으로 저장됩니다. 원문은 90일 뒤 지워집니다.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <label className="flex items-center gap-1">세목
            <select className="rounded-md border bg-background px-2 py-1" value={topic ?? "*"} onChange={(e) => setTopic(e.target.value === "*" ? null : e.target.value)}>
              <option value="*">전체</option>
              {topics.map((t) => <option key={t || "none"} value={t}>{t || "분류 없음"}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1">결과
            <select className="rounded-md border bg-background px-2 py-1" value={group ?? "*"} onChange={(e) => setGroup(e.target.value === "*" ? null : e.target.value as OutcomeGroup)}>
              <option value="*">전체</option>
              {OUTCOME_GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
            </select>
          </label>
        </div>
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">질문 목록을 불러오지 못했어요.</p>
        : rows === null ? <p role="status" className="text-sm text-muted-foreground">불러오는 중…</p>
        : rows.length === 0 ? <Empty>{topic !== null || group ? "조건에 맞는 질문이 없어요." : "이 기간에 저장된 질문 원문이 없어요(원문 저장은 10/24 정오부터)."}</Empty>
        : <>
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 py-2.5">
                <p className="whitespace-pre-wrap break-words text-sm">{r.text}</p>
                <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span>{kstTime(r.at)}</span>
                  <span>{sourceLabel(r.source)}{r.campaign ? ` · ${r.campaign}` : ""}</span>
                  <span>{r.taxTopic ?? "세목 없음"}{r.questionType ? ` · ${r.questionType}` : ""}</span>
                  <span>{outcomeLabel(r.outcome)}</span>
                  {r.clicked && <span className="font-medium text-foreground">세무사 연결 클릭</span>}
                </p>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>{fmt(rows.length)} / {fmt(total)}개</span>
            {rows.length < total && <Button size="sm" variant="outline" onClick={() => void load(rows.length)}>더 보기</Button>}
          </div>
        </>}
    </section>
  );
}
