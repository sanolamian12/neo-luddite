"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { Minus, Plus, RefreshCw, ZoomIn } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import * as ragService from "@/services/rag";
import type { PassageInfo } from "@/services/rag";

/**
 * KB 전체 거미줄 그래프 — auditor 가 KB 전체 구조를 한 화면에서 훑어보는 화면.
 *
 * kb-map-view(메타데이터 클러스터 그리드)·kb-passage-detail-view(1-hop 방사형)와 달리,
 * 이건 rag.passage_edges(배치로 미리 계산된 유사도 edge, pg_cron 5분 주기)를 그대로 읽어
 * KB 전체를 하나의 force-directed 그래프로 그린다. 조회 시점에 KB 전체를 다시 재지
 * 않으므로 KB 가 커져도 이 화면 자체의 비용은 늘지 않는다(2026-08-28 결정).
 *
 * 노드를 클릭하면 기존 상세뷰(/audit/kb-map/[id])로 이동한다 — 거기서 유사도 이웃을
 * 더 자세히 보고 "수정 제안"(§3.4)도 그대로 할 수 있다. 이 화면은 KB 를 훑어보다가
 * 손볼 지점을 찾아내는 입구 역할.
 */

const WIDTH = 900;
const HEIGHT = 620;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 4;

interface GraphNode extends SimulationNodeDatum {
  id: string;
  info: PassageInfo;
  degree: number;
}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  score: number;
}

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

function clusterLabel(p: PassageInfo): string {
  return p.taxCategory || p.occupation || p.sourceKind;
}

export function KbGraphView() {
  const router = useRouter();
  const [passages, setPassages] = useState<PassageInfo[] | null>(null);
  const [edgePairs, setEdgePairs] = useState<{ a: string; b: string; score: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);

  const [vb, setVb] = useState({ x: 0, y: 0, w: WIDTH, h: HEIGHT });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [ps, edgeRes] = await Promise.all([ragService.listPassages(), ragService.listPassageEdges()]);
      setPassages(ps);
      // 방향성 top-k edge 를 무방향 쌍으로 dedupe(양방향이면 더 높은 score 유지).
      const dedup = new Map<string, { a: string; b: string; score: number }>();
      for (const e of edgeRes.edges) {
        const key = [e.sourceId, e.targetId].sort().join("|");
        const prev = dedup.get(key);
        if (!prev || e.score > prev.score) {
          dedup.set(key, { a: e.sourceId, b: e.targetId, score: e.score });
        }
      }
      setEdgePairs([...dedup.values()]);
    } catch (e) {
      setPassages([]);
      setEdgePairs([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const rebuild = async () => {
    setRebuilding(true);
    try {
      await ragService.rebuildPassageEdges();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRebuilding(false);
    }
  };

  // active passage 만 그래프 대상(edge 는 애초에 active-active 쌍만 존재).
  const activePassages = useMemo(
    () => (passages ?? []).filter((p) => p.status === "active"),
    [passages],
  );

  const { nodes, links } = useMemo(() => {
    const byId = new Map(activePassages.map((p) => [p.id, p]));
    const degree = new Map<string, number>();
    const links: GraphLink[] = [];
    for (const e of edgePairs ?? []) {
      if (!byId.has(e.a) || !byId.has(e.b)) continue;
      links.push({ source: e.a, target: e.b, score: e.score });
      degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
      degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
    }
    const nodes: GraphNode[] = activePassages.map((p) => ({
      id: p.id,
      info: p,
      degree: degree.get(p.id) ?? 0,
    }));
    return { nodes, links };
  }, [activePassages, edgePairs]);

  // 정적 레이아웃 — 실시간 애니메이션 대신 시뮬레이션을 수렴시켜 한 번만 계산한다.
  const laidOut = useMemo(() => {
    if (nodes.length === 0) return { nodes: [] as GraphNode[], links: [] as GraphLink[] };
    const simNodes = nodes.map((n) => ({ ...n }));
    const simLinks = links.map((l) => ({ ...l }));
    const sim = forceSimulation(simNodes)
      .force(
        "link",
        forceLink<GraphNode, GraphLink>(simLinks)
          .id((d) => d.id)
          .distance((l) => 140 - l.score * 90)
          .strength((l) => 0.15 + l.score * 0.5),
      )
      .force("charge", forceManyBody().strength(-140))
      .force("center", forceCenter(WIDTH / 2, HEIGHT / 2))
      .force(
        "collide",
        forceCollide<GraphNode>().radius((d) => 10 + Math.min(d.degree, 10) * 1.5),
      )
      .stop();
    for (let i = 0; i < 300; i++) sim.tick();
    return { nodes: simNodes, links: simLinks };
  }, [nodes, links]);

  const zoomed = vb.w < WIDTH * 0.65; // 줌인 상태 — 라벨/강조 표시 기준

  const vbRef = useRef(vb);
  useEffect(() => {
    vbRef.current = vb;
  }, [vb]);

  const applyZoom = (factor: number, cx?: number, cy?: number) => {
    setVb((prev) => {
      const nw = Math.min(WIDTH / MIN_ZOOM, Math.max(WIDTH / MAX_ZOOM, prev.w * factor));
      const ratio = nw / prev.w;
      const px = cx ?? prev.x + prev.w / 2;
      const py = cy ?? prev.y + prev.h / 2;
      const nh = prev.h * ratio;
      return {
        x: px - (px - prev.x) * ratio,
        y: py - (py - prev.y) * ratio,
        w: nw,
        h: nh,
      };
    });
  };

  // React 는 onWheel 을 passive 리스너로 등록해 preventDefault() 가 조용히 무시된다 —
  // 그러면 줌 중에 브라우저 기본 페이지 스크롤이 같이 일어난다. 네이티브 리스너를
  // { passive: false } 로 직접 붙여야 실제로 막힌다.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cur = vbRef.current;
      const px = cur.x + ((e.clientX - rect.left) / rect.width) * cur.w;
      const py = cur.y + ((e.clientY - rect.top) / rect.height) * cur.h;
      applyZoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, px, py);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePointerDown: React.PointerEventHandler<HTMLDivElement> = (e) => {
    dragRef.current = { x: e.clientX, y: e.clientY };
  };
  const handlePointerMove: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (!dragRef.current) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = ((e.clientX - dragRef.current.x) / rect.width) * vb.w;
    const dy = ((e.clientY - dragRef.current.y) / rect.height) * vb.h;
    dragRef.current = { x: e.clientX, y: e.clientY };
    setVb((prev) => ({ ...prev, x: prev.x - dx, y: prev.y - dy }));
  };
  const endDrag = () => {
    dragRef.current = null;
  };
  const resetView = () => setVb({ x: 0, y: 0, w: WIDTH, h: HEIGHT });

  const hoveredNode = laidOut.nodes.find((n) => n.id === hovered);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">
          유사도 top-8 edge 로 이은 KB 전체 그래프입니다. 휠로 줌인/줌아웃, 드래그로 이동,
          노드 클릭 시 상세뷰로 이동합니다. edge 는 5분마다 자동 재계산됩니다.
        </p>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={() => applyZoom(1 / 1.3)}>
            <Plus className="size-3.5" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => applyZoom(1.3)}>
            <Minus className="size-3.5" />
          </Button>
          <Button size="sm" variant="outline" onClick={resetView}>
            <ZoomIn className="size-3.5" />
            초기화
          </Button>
          <Button size="sm" variant="outline" onClick={() => void rebuild()} disabled={rebuilding}>
            <RefreshCw className={rebuilding ? "size-3.5 animate-spin" : "size-3.5"} />
            지금 재계산
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">로딩 중…</p>
      ) : laidOut.nodes.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
          아직 그래프로 그릴 edge 가 없습니다. KB가 2건 이상 쌓이고 첫 재계산(최대 5분)이
          지나면 나타납니다.
        </p>
      ) : (
        <div
          ref={containerRef}
          className="relative h-[640px] w-full touch-none overflow-hidden rounded-xl border bg-card"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
        >
          <svg
            data-testid="kb-graph-canvas"
            viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
            className="h-full w-full cursor-grab active:cursor-grabbing"
          >
            {laidOut.links.map((l, i) => {
              const s = l.source as unknown as GraphNode;
              const t = l.target as unknown as GraphNode;
              return (
                <line
                  key={i}
                  x1={s.x}
                  y1={s.y}
                  x2={t.x}
                  y2={t.y}
                  stroke="currentColor"
                  strokeOpacity={0.1 + l.score * 0.3}
                  strokeWidth={1}
                  className="text-muted-foreground"
                />
              );
            })}
            {laidOut.nodes.map((n) => {
              const hue = hashHue(clusterLabel(n.info));
              const r = 6 + Math.min(n.degree, 10) * 1.2;
              const isHovered = hovered === n.id;
              return (
                <g
                  key={n.id}
                  className="cursor-pointer"
                  onMouseEnter={() => setHovered(n.id)}
                  onMouseLeave={() => setHovered((h) => (h === n.id ? null : h))}
                  onClick={() => router.push(`/audit/kb-map/${encodeURIComponent(n.id)}`)}
                >
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={isHovered ? r + 4 : r}
                    fill={`hsl(${hue} 60% 55%)`}
                    stroke="var(--card)"
                    strokeWidth={1.5}
                    opacity={isHovered ? 1 : 0.9}
                  />
                  {(zoomed || isHovered) && (
                    <text
                      x={n.x}
                      y={(n.y ?? 0) + r + 12}
                      textAnchor="middle"
                      className="fill-muted-foreground text-[9px]"
                    >
                      {clusterLabel(n.info).slice(0, 14)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {hoveredNode && (
            <div className="absolute bottom-2 left-2 right-2 rounded-md border bg-card/95 px-3 py-2 text-xs shadow-sm backdrop-blur">
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="text-[10px]">{hoveredNode.info.sourceKind}</Badge>
                {hoveredNode.info.taxCategory && (
                  <Badge variant="secondary" className="text-[10px]">{hoveredNode.info.taxCategory}</Badge>
                )}
                <span className="ml-auto text-muted-foreground">이웃 {hoveredNode.degree}개 · 클릭해서 열기</span>
              </div>
              <p className="line-clamp-2 text-foreground">{hoveredNode.info.content}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
