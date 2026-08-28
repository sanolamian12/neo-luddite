"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { FileText, MessageSquare, Network, RefreshCw, Scale, Sparkles, Waypoints } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/poc-format";
import * as ragService from "@/services/rag";
import type { PassageInfo } from "@/services/rag";
import { KbGraphView } from "./kb-graph-view";

/**
 * RAG 지식망 — auditor 가 solar-pro3 가 실제로 참조하는 KB(rag.passages)를 들여다보는 화면.
 *
 * 구조 분석(2026-08-27): KB 는 그래프가 아니라 flat 벡터 리스트다. 항목 간 저장된 연결(edge)은
 * 원래 없었고, "관계"는 (1) 세목/직업군/유형 같은 공유 메타데이터, (2) 조회 시점에 계산되는
 * 코사인 유사도뿐이었다. 그래서 기본 뷰는 메타데이터 클러스터 그리드로 남아있다.
 *
 * 2026-08-28: 세무사와 RAG/KB 사이의 중간층(로드맵 §3.5) — KB 전체를 거미줄 그래프로
 * 훑어보고 필요하면 직접 수정할 수 있는 화면 — 을 "전체 그래프" 탭으로 추가했다
 * (KbGraphView, rag.passage_edges 배치 계산 기반). 개별 passage 를 열면(상세뷰) 유사도
 * 이웃 + 수정 제안(§3.4)까지 이어진다(/audit/kb-map/[id]).
 */

const SOURCE_KIND_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  feedback: { label: "세무사 코멘트", icon: MessageSquare },
  session_eval: { label: "세션 총평", icon: Sparkles },
  case_seed: { label: "판례 시드", icon: Scale },
  kb_document: { label: "큐레이션 문서", icon: FileText },
};

function sourceKindMeta(kind: string) {
  return SOURCE_KIND_META[kind] ?? { label: kind, icon: FileText };
}

type Axis = "taxCategory" | "occupation" | "sourceKind";

const AXIS_LABEL: Record<Axis, string> = {
  taxCategory: "세목",
  occupation: "직업군",
  sourceKind: "유형",
};

const UNCLASSIFIED = "(미분류)";

function clusterKey(p: PassageInfo, axis: Axis): string {
  if (axis === "sourceKind") return sourceKindMeta(p.sourceKind).label;
  const v = p[axis];
  return v && v.trim() ? v : UNCLASSIFIED;
}

type ViewMode = "clusters" | "graph";

export function KbMapView() {
  const [viewMode, setViewMode] = useState<ViewMode>("graph");
  const [passages, setPassages] = useState<PassageInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [axis, setAxis] = useState<Axis>("taxCategory");
  const [showRetired, setShowRetired] = useState(false);
  const [selectedCluster, setSelectedCluster] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await ragService.listPassages();
      setPassages(data);
      setError(null);
    } catch (e) {
      setPassages([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const data = await ragService.listPassages();
        if (!ignore) {
          setPassages(data);
          setError(null);
        }
      } catch (e) {
        if (!ignore) {
          setPassages([]);
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  const visible = useMemo(
    () => (passages ?? []).filter((p) => showRetired || p.status === "active"),
    [passages, showRetired],
  );

  const clusters = useMemo(() => {
    const byKey = new Map<string, PassageInfo[]>();
    for (const p of visible) {
      const key = clusterKey(p, axis);
      const arr = byKey.get(key) ?? [];
      arr.push(p);
      byKey.set(key, arr);
    }
    return [...byKey.entries()].sort((a, b) => {
      // "(미분류)"는 분류 실패/애매 항목이라 다른 클러스터와 값을 못 겨루므로 항상 맨 뒤로.
      if (a[0] === UNCLASSIFIED && b[0] !== UNCLASSIFIED) return 1;
      if (b[0] === UNCLASSIFIED && a[0] !== UNCLASSIFIED) return -1;
      return b[1].length - a[1].length;
    });
  }, [visible, axis]);

  useEffect(() => {
    // 축을 바꾸면 이전 선택 클러스터가 더 이상 없을 수 있다 — 선택 해제.
    if (selectedCluster && !clusters.some(([k]) => k === selectedCluster)) {
      setSelectedCluster(null);
    }
  }, [clusters, selectedCluster]);

  const activeInClusters = clusters.reduce((sum, [, ps]) => sum + ps.length, 0);
  const shownPassages = selectedCluster
    ? (clusters.find(([k]) => k === selectedCluster)?.[1] ?? [])
    : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Network className="size-6 text-brand-green" />
            RAG 지식망
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            solar-pro3 가 실제로 참조하는 KB 구성입니다. 「클러스터」는 세목·직업군·유형 같은
            메타데이터로 묶은 그리드, 「전체 그래프」는 미리 계산된 유사도로 이은 거미줄
            그래프입니다. 개별 항목을 열면 유사도 이웃과 수정 제안까지 이어집니다.
          </p>
        </div>
        {viewMode === "clusters" && (
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="size-3.5" />
            새로고침
          </Button>
        )}
      </header>

      <div className="flex items-center gap-1.5 border-b">
        <button
          type="button"
          onClick={() => setViewMode("graph")}
          className={cn(
            "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            viewMode === "graph"
              ? "border-brand-green text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <Waypoints className="size-4" />
          전체 그래프
        </button>
        <button
          type="button"
          onClick={() => setViewMode("clusters")}
          className={cn(
            "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            viewMode === "clusters"
              ? "border-brand-green text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <Network className="size-4" />
          클러스터
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {viewMode === "graph" && <KbGraphView />}

      {viewMode === "clusters" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">묶는 기준</span>
            {(Object.keys(AXIS_LABEL) as Axis[]).map((a) => (
              <Button
                key={a}
                size="sm"
                variant={axis === a ? "default" : "outline"}
                onClick={() => setAxis(a)}
              >
                {AXIS_LABEL[a]}
              </Button>
            ))}
            <span className="mx-1 h-4 w-px bg-border" />
            <span className="text-xs text-muted-foreground">연결끊김 포함</span>
            <button
              type="button"
              role="switch"
              aria-checked={showRetired}
              onClick={() => setShowRetired((v) => !v)}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors",
                showRetired ? "border-brand-green bg-brand-green" : "border-border bg-muted",
              )}
            >
              <span
                className={cn(
                  "inline-block size-4 transform rounded-full bg-white shadow transition-transform",
                  showRetired ? "translate-x-[22px]" : "translate-x-1",
                )}
              />
            </button>
            <span className="text-xs font-medium tabular-nums text-muted-foreground">
              {showRetired ? "ON" : "OFF"}
            </span>
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              {loading ? "로딩 중…" : `${activeInClusters}건 · 클러스터 ${clusters.length}개`}
            </span>
          </div>

          {loading ? (
            <p className="py-12 text-center text-sm text-muted-foreground">로딩 중…</p>
          ) : clusters.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
              아직 RAG 에 실린 지식이 없습니다. 검수 확정 코멘트가 쌓이면 여기 클러스터로 나타납니다.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {clusters.map(([key, ps]) => {
                const activeCount = ps.filter((p) => p.status === "active").length;
                const sampleTags = [...new Set(ps.flatMap((p) => p.feedbackTags))].slice(0, 3);
                const selected = selectedCluster === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedCluster(selected ? null : key)}
                    className={cn(
                      "flex flex-col gap-2 rounded-xl border bg-card px-4 py-3 text-left transition-colors hover:border-brand-green/50",
                      selected && "border-brand-green ring-1 ring-brand-green/40",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold" title={key}>
                        {key}
                      </span>
                      <Badge variant={selected ? "default" : "secondary"}>{ps.length}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      활성 {activeCount}
                      {ps.length !== activeCount && ` · 끊김 ${ps.length - activeCount}`}
                    </p>
                    {sampleTags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {sampleTags.map((t) => (
                          <Badge key={t} variant="outline" className="text-[10px]">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {selectedCluster && (
            <section className="rounded-xl border bg-card">
              <header className="flex items-center justify-between border-b px-4 py-2">
                <h2 className="text-sm font-semibold">
                  {selectedCluster} <span className="text-muted-foreground">· {shownPassages.length}건</span>
                </h2>
                <Button size="sm" variant="ghost" onClick={() => setSelectedCluster(null)}>
                  닫기
                </Button>
              </header>
              <ul className="divide-y">
                {shownPassages
                  .sort((a, b) => b.createdAt - a.createdAt)
                  .map((p) => {
                    const meta = sourceKindMeta(p.sourceKind);
                    return (
                      <li key={p.id}>
                        <Link
                          href={`/audit/kb-map/${encodeURIComponent(p.id)}`}
                          className="flex flex-col gap-1.5 px-4 py-3 hover:bg-muted/30"
                        >
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline" className="gap-1 text-[10px]">
                              <meta.icon className="size-3" />
                              {meta.label}
                            </Badge>
                            {p.status === "retired" && (
                              <Badge variant="secondary" className="text-[10px]">
                                연결끊김
                              </Badge>
                            )}
                            {p.feedbackTags.map((t) => (
                              <Badge key={t} variant="ghost" className="text-[10px]">
                                {t}
                              </Badge>
                            ))}
                            <span className="ml-auto text-xs text-muted-foreground">
                              {formatDateTime(p.createdAt)}
                            </span>
                          </div>
                          <p className="line-clamp-2 text-sm text-foreground">{p.content}</p>
                          <p className="text-xs text-muted-foreground">
                            {p.reviewer ?? p.auditorId ?? "—"}
                          </p>
                        </Link>
                      </li>
                    );
                  })}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
