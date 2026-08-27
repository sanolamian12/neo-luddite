"use client";

import { useEffect, useMemo, useState } from "react";
import { Network, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime } from "@/lib/poc-format";
import { cn } from "@/lib/utils";
import * as ragService from "@/services/rag";
import type { ContributionCount, PassageInfo } from "@/services/rag";

/**
 * RAG 지식망 추이 — "기여 = KB 존속기간" 을 시간축으로 보여준다(메모리
 * project_operational_flow). 세무사가 담은 passage 가 얼마나 오래 active 로 살아
 * 있는지, 언제 retired 됐는지를 auditor 별 타임라인(간트형)으로 시각화한다.
 *
 * KB 구조 분석(2026-08-27)에 따르면 passage 간 저장된 관계는 없고, 유일하게 시간에
 * 따라 변하는 상태는 status(active/retired) 뿐이다 — 그래서 이 화면은 그래프가 아니라
 * "존속" 자체를 축으로 삼는다. admin 이 세무사별 기여 추이를 한눈에 보고, 최종승인 이후
 * KB 편집 워크플로우(다음 단계 과제)의 근거 화면이 된다.
 */

const ROW_H = 28;
const ROW_GAP = 6;
const LEFT_PAD = 140;
const RIGHT_PAD = 16;

export function RagTimelineView() {
  const [passages, setPassages] = useState<PassageInfo[] | null>(null);
  const [contributions, setContributions] = useState<ContributionCount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [ps, contrib] = await Promise.all([
        ragService.listPassages(),
        ragService.listContributions(),
      ]);
      setPassages(ps);
      setContributions(contrib.contributions);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPassages([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const [ps, contrib] = await Promise.all([
          ragService.listPassages(),
          ragService.listContributions(),
        ]);
        if (!ignore) {
          setPassages(ps);
          setContributions(contrib.contributions);
          setError(null);
        }
      } catch (e) {
        if (!ignore) {
          setError(e instanceof Error ? e.message : String(e));
          setPassages([]);
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  const byAuditor = useMemo(() => {
    const map = new Map<string, PassageInfo[]>();
    for (const p of passages ?? []) {
      if (!p.auditorId) continue;
      const arr = map.get(p.auditorId) ?? [];
      arr.push(p);
      map.set(p.auditorId, arr);
    }
    // 기여도(activeCount) 순으로 정렬 — contributions 이 없는(전부 retired) auditor 는 뒤로.
    const rank = new Map(contributions.map((c) => [c.auditorId, c.activeCount]));
    return [...map.entries()].sort((a, b) => (rank.get(b[0]) ?? 0) - (rank.get(a[0]) ?? 0));
  }, [passages, contributions]);

  const now = Date.now();
  const domain = useMemo(() => {
    const all = passages ?? [];
    if (all.length === 0) return { min: now - 86_400_000 * 7, max: now };
    const min = Math.min(...all.map((p) => p.createdAt));
    return { min, max: now };
  }, [passages, now]);

  const xFor = (ts: number, width: number) => {
    const span = Math.max(1, domain.max - domain.min);
    const usable = width - LEFT_PAD - RIGHT_PAD;
    return LEFT_PAD + ((ts - domain.min) / span) * usable;
  };

  const maxActive = Math.max(1, ...contributions.map((c) => c.activeCount));

  return (
    <div className="flex flex-col gap-5 px-6 py-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Network className="size-6 text-brand-amber" />
            RAG 지식망 추이
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            세무사별 기여도(살아있는 passage 수)와, 각 항목이 언제 실려 언제까지 살아있는지를
            시간축으로 봅니다. 기여 = KB 존속기간의 근거 화면입니다.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="size-3.5" />
          새로고침
        </Button>
      </header>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">로딩 중…</p>
      ) : (
        <>
          {/* 기여도 순위 */}
          <section className="rounded-xl border bg-card">
            <header className="border-b px-4 py-2 text-sm font-semibold">기여도 순위 (살아있는 passage 수)</header>
            {contributions.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">아직 살아있는 기여가 없습니다.</p>
            ) : (
              <ul className="divide-y">
                {contributions
                  .slice()
                  .sort((a, b) => b.activeCount - a.activeCount)
                  .map((c) => (
                    <li key={c.auditorId} className="flex items-center gap-3 px-4 py-2">
                      <span className="w-32 shrink-0 truncate font-mono text-xs" title={c.auditorId}>
                        {c.auditorId}
                      </span>
                      <div className="h-3 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-brand-green"
                          style={{ width: `${(c.activeCount / maxActive) * 100}%` }}
                        />
                      </div>
                      <span className="w-8 shrink-0 text-right text-xs tabular-nums">{c.activeCount}</span>
                    </li>
                  ))}
              </ul>
            )}
          </section>

          {/* 존속기간 타임라인 (간트) */}
          <section className="rounded-xl border bg-card">
            <header className="flex items-center justify-between border-b px-4 py-2">
              <h2 className="text-sm font-semibold">존속기간 타임라인</h2>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="inline-block size-2.5 rounded-full bg-brand-green" /> 활성(지금도 참조됨)
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block size-2.5 rounded-full bg-muted-foreground/50" /> 연결끊김
                </span>
              </div>
            </header>
            {byAuditor.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                아직 auditor 귀속 passage 가 없습니다.
              </p>
            ) : (
              <div className="overflow-x-auto px-2 py-3">
                <svg
                  viewBox={`0 0 900 ${byAuditor.length * (ROW_H + ROW_GAP) + 24}`}
                  className="w-full min-w-[640px]"
                  role="img"
                  aria-label="존속기간 타임라인"
                >
                  {/* 도메인 시작/끝 라벨 */}
                  <text x={LEFT_PAD} y={14} className="fill-muted-foreground text-[10px]">
                    {formatDate(domain.min)}
                  </text>
                  <text x={900 - RIGHT_PAD} y={14} textAnchor="end" className="fill-muted-foreground text-[10px]">
                    지금
                  </text>
                  {byAuditor.map(([auditorId, ps], rowIdx) => {
                    const y = 24 + rowIdx * (ROW_H + ROW_GAP);
                    return (
                      <g key={auditorId}>
                        <text x={0} y={y + ROW_H / 2 + 4} className="fill-foreground text-[11px] font-mono">
                          {auditorId.length > 16 ? `${auditorId.slice(0, 16)}…` : auditorId}
                        </text>
                        {ps.map((p) => {
                          const x1 = xFor(p.createdAt, 900);
                          const end = p.status === "retired" ? p.updatedAt : now;
                          const x2 = Math.max(x1 + 3, xFor(end, 900));
                          return (
                            <rect
                              key={p.id}
                              x={x1}
                              y={y + 4}
                              width={x2 - x1}
                              height={ROW_H - 8}
                              rx={3}
                              className={cn(p.status === "active" ? "fill-brand-green" : "fill-muted-foreground/50")}
                              opacity={p.status === "active" ? 0.85 : 0.6}
                            >
                              <title>
                                {`${p.sourceKind} · ${formatDateTime(p.createdAt)} → ${p.status === "retired" ? formatDateTime(p.updatedAt) : "지금"}`}
                              </title>
                            </rect>
                          );
                        })}
                      </g>
                    );
                  })}
                </svg>
              </div>
            )}
          </section>

          <div className="flex flex-wrap gap-1.5 rounded-xl border border-dashed px-4 py-3 text-xs text-muted-foreground">
            <Badge variant="outline">읽기 전용</Badge>
            <span>
              auditor 쪽 RAG 지식망(/audit/kb-map)에서 본 클러스터·유사도 이웃과 같은 KB(rag.passages)를
              시간축으로 재구성한 화면입니다. 개별 항목 승인/반려 워크플로우는 아직 없습니다(다음 단계 과제).
            </span>
          </div>
        </>
      )}
    </div>
  );
}
