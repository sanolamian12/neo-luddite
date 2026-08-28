"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { evalContributionUnits } from "@/lib/audit-schema";
import { clusterHue, primaryClusterLabel } from "@/lib/kb-cluster-colors";
import { parseBundleContent } from "@/lib/kb-passage-text";
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
 * 노드를 클릭하면 먼저 포커스(연결된 이웃 하이라이트 + 카메라 이동)만 하고, 포커스된
 * 상태에서 한 번 더 클릭해야 상세뷰(/audit/kb-map/[id])로 이동한다(2026-08-28, 사용자
 * UX 피드백) — 거기서 유사도 이웃을 더 자세히 보고 "수정 제안"(§3.4)도 그대로 할 수 있다.
 */

const WIDTH = 900;
const HEIGHT = 620;
// 배율 100% = 전체 그래프가 화면에 다 들어오는 fitBox 기준(아래 참고). 이 값은 그 기준
// 대비 얼마나 더 확대/축소할 수 있는지의 배수다.
const MIN_ZOOM_PCT = 0.25;
const MAX_ZOOM_PCT = 8;
const NODE_PADDING = 24;
const FOCUS_PADDING = 60;

interface GraphNode extends SimulationNodeDatum {
  id: string;
  info: PassageInfo;
  degree: number;
}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  score: number;
}

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 총평/문장코멘트 크레딧 산정과 같은 글자수 6구간 눈금(frontend/lib/audit-schema.ts)을
// 노드 크기에도 그대로 쓴다 — 세무사가 실제로 쓴 텍스트(코멘트/총평)가 길수록 큰 원.
function contributionUnits(info: PassageInfo): number {
  const { comment } = parseBundleContent(info.content);
  return evalContributionUnits(comment || info.content);
}

function nodeRadius(units: number): number {
  return 6 + units * 2.4;
}

// 노드 라벨용 — 형태소 분석기 없이 쓰는 가벼운 휴리스틱: 조사/흔한 상투어를 거르고
// 남은 토큰 중 가장 긴 것(한국어에서 길수록 조사가 아닌 실질 명사일 확률이 높다)을 고른다.
const KEYWORD_STOPWORDS = new Set([
  "그리고", "그런데", "그러면", "그래서", "저는", "제가", "저희", "이번", "오늘", "혹시",
  "합니다", "했습니다", "되나요", "되는지", "궁금합니다", "드립니다", "있나요", "있을까요",
  "무엇인가요", "어떻게", "입니다", "것인가요", "인가요", "있는지", "하는지", "해야",
]);

function significantWords(text: string): string[] {
  return text
    .replace(/[.,!?()"'…\-·]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !KEYWORD_STOPWORDS.has(w));
}

// 형태소 분석기 없이 명사 위주로 고르는 트릭 — 조사를 떼진 않되(번거로움), 한국어 술어
// (동사/형용사)는 활용형 어미가 거의 고정 패턴으로 끝난다는 점을 이용해 그런 단어를
// 후보에서 낮은 우선순위로 민다. 다 걸러지면(짧은 문장 등) 원래 후보로 폴백한다.
const PREDICATE_ENDING =
  /(습니다|ㅂ니다|니다|여요|아요|어요|나요|가요|네요|이에요|예요|이죠|죠|겠나요|겠습니까|입니까|하는지|되는지|했는지|한다면|하다면|다면|한다|했다|였다|이다|합니다|하셨나요|하시나요|되시나요|했나요)$/;

function isNounLike(word: string): boolean {
  return !PREDICATE_ENDING.test(word);
}

/**
 * "유사도를 판단하는 핵심 단어"의 근사치 — 형태소 분석기·재임베딩 없이 쓰는 휴리스틱.
 * rag.match_passages 가 실제로 비교하는 벡터는 passage.content 전체(build_bundle_text 가
 * 조립한 [질문]+[AI 답변]+[세무사 코멘트]+태그)를 임베딩한 값이다(backend/api/rag/ingest.py).
 * 같은 문서 안에서 여러 번 반복되는 단어일수록 그 문서의 임베딩 방향을 더 세게 끌고
 * 가는 경향이 있으므로, "이 passage 안에서의 등장 빈도"를 살리는 것(TF)이 어느 한
 * 섹션(질문만/코멘트만)에서 고르는 것보다 실제 유사도 판정에 가깝다.
 */
function extractSalientWords(text: string, max = 3): string[] {
  const words = significantWords(text);
  const nounLike = words.filter(isNounLike);
  const pool = nounLike.length > 0 ? nounLike : words;
  const freq = new Map<string, number>();
  for (const w of pool) freq.set(w, (freq.get(w) ?? 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, max)
    .map(([w]) => w);
}

/**
 * 노드 라벨 — passage 전체(임베딩 대상 텍스트 그대로)에서 등장 빈도 기준 핵심 단어 2~3개.
 * 포커스 여부와 무관하게 항상 같은 키워드 묶음이 보이도록 호버/포커스 상태를 안 탄다.
 */
function nodeKeywords(info: PassageInfo): string[] {
  return extractSalientWords(info.content, 3);
}

function boundingBox(nodes: GraphNode[], padding: number): ViewBox {
  if (nodes.length === 0) return { x: 0, y: 0, w: WIDTH, h: HEIGHT };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const r = nodeRadius(contributionUnits(n.info));
    minX = Math.min(minX, (n.x ?? 0) - r);
    maxX = Math.max(maxX, (n.x ?? 0) + r);
    minY = Math.min(minY, (n.y ?? 0) - r);
    maxY = Math.max(maxY, (n.y ?? 0) + r);
  }
  return {
    x: minX - padding,
    y: minY - padding,
    w: maxX - minX + padding * 2,
    h: maxY - minY + padding * 2,
  };
}

export function KbGraphView() {
  const router = useRouter();
  const [passages, setPassages] = useState<PassageInfo[] | null>(null);
  const [edgePairs, setEdgePairs] = useState<{ a: string; b: string; score: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const [vb, setVb] = useState<ViewBox>({ x: 0, y: 0, w: WIDTH, h: HEIGHT });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wheelCleanupRef = useRef<(() => void) | null>(null);
  const animRef = useRef<number | null>(null);
  const didFitRef = useRef(false);

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

  // 클릭한 노드의 이웃 조회용 인접 리스트 — 시뮬레이션 돌기 전(source/target 이 아직
  // 문자열 id인) links 로 만든다.
  const neighborsOf = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of links) {
      const s = typeof l.source === "string" ? l.source : (l.source as GraphNode).id;
      const t = typeof l.target === "string" ? l.target : (l.target as GraphNode).id;
      if (!m.has(s)) m.set(s, new Set());
      if (!m.has(t)) m.set(t, new Set());
      m.get(s)!.add(t);
      m.get(t)!.add(s);
    }
    return m;
  }, [links]);

  // 세목/직업군/유형 색상 범례 — 실제로 그래프에 있는 클러스터만, 많은 순으로.
  const legend = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of nodes) {
      const label = primaryClusterLabel(n.info);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [nodes]);

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
        forceCollide<GraphNode>().radius((d) => nodeRadius(contributionUnits(d.info)) + 4),
      )
      .stop();
    for (let i = 0; i < 300; i++) sim.tick();
    return { nodes: simNodes, links: simLinks };
  }, [nodes, links]);

  // 배율 100% 기준 — 그래프 전체(+여백)가 화면에 들어오는 뷰박스.
  const fitBox = useMemo(() => boundingBox(laidOut.nodes, NODE_PADDING), [laidOut]);
  const fitBoxRef = useRef(fitBox);
  useEffect(() => {
    fitBoxRef.current = fitBox;
  }, [fitBox]);

  // 데이터가 처음 들어오면 딱 한 번 fitBox 로 초기 배율을 맞춘다(그 뒤 새로고침/재계산 때는
  // 사용자가 잡은 화면을 존중해 건드리지 않는다).
  useEffect(() => {
    if (!didFitRef.current && laidOut.nodes.length > 0) {
      setVb(fitBox);
      didFitRef.current = true;
    }
  }, [laidOut, fitBox]);

  const zoomed = vb.w < fitBox.w * 0.65; // 줌인 상태 — 라벨/강조 표시 기준
  const zoomPct = fitBox.w > 0 ? Math.round((fitBox.w / vb.w) * 100) : 100;

  const vbRef = useRef(vb);
  useEffect(() => {
    vbRef.current = vb;
  }, [vb]);

  const applyZoom = useCallback((factor: number, cx?: number, cy?: number) => {
    setVb((prev) => {
      const fb = fitBoxRef.current;
      const nw = Math.min(fb.w / MIN_ZOOM_PCT, Math.max(fb.w / MAX_ZOOM_PCT, prev.w * factor));
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
  }, []);

  // rAF 로 현재 뷰박스에서 target 까지 부드럽게 보간 — 노드 포커스 시 "액션캠" 이동에 쓴다.
  const animateTo = useCallback((target: ViewBox, duration = 320) => {
    if (animRef.current != null) cancelAnimationFrame(animRef.current);
    const start = vbRef.current;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const ease = 1 - Math.pow(1 - t, 3);
      setVb({
        x: start.x + (target.x - start.x) * ease,
        y: start.y + (target.y - start.y) * ease,
        w: start.w + (target.w - start.w) * ease,
        h: start.h + (target.h - start.h) * ease,
      });
      if (t < 1) {
        animRef.current = requestAnimationFrame(step);
      } else {
        animRef.current = null;
      }
    };
    animRef.current = requestAnimationFrame(step);
  }, []);

  // React 는 onWheel 을 passive 리스너로 등록해 preventDefault() 가 조용히 무시된다 —
  // 그러면 줌 중에 브라우저 기본 페이지 스크롤이 같이 일어난다. 네이티브 리스너를
  // { passive: false } 로 직접 붙여야 실제로 막힌다.
  //
  // 콜백 ref 로 붙인다: 예전엔 useEffect(mount 시 1회)로 붙였는데, 그 시점엔 로딩 중이라
  // containerRef.current 가 아직 null 이라 리스너가 영원히 안 붙는 버그가 있었다(그래프가
  // 로딩을 마치고 실제 DOM 이 나타난 뒤에는 재실행이 안 됨). 콜백 ref 는 DOM 이 실제로
  // 마운트되는 시점에 호출되므로 이 문제가 없다.
  const attachContainer = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
    if (wheelCleanupRef.current) {
      wheelCleanupRef.current();
      wheelCleanupRef.current = null;
    }
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
    wheelCleanupRef.current = () => el.removeEventListener("wheel", onWheel);
  }, [applyZoom]);

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
  const resetView = () => {
    setFocusedId(null);
    animateTo(fitBox);
  };

  // 노드 클릭: 처음 클릭하면 포커스(이웃 하이라이트 + 카메라 이동)만, 이미 포커스된
  // 노드를 한 번 더 클릭해야 상세뷰로 이동한다.
  const handleNodeClick = (n: GraphNode) => {
    if (focusedId === n.id) {
      router.push(`/audit/kb-map/${encodeURIComponent(n.id)}`);
      return;
    }
    setFocusedId(n.id);
    const neigh = neighborsOf.get(n.id) ?? new Set<string>();
    const involved = laidOut.nodes.filter((m) => m.id === n.id || neigh.has(m.id));
    const box = boundingBox(involved.length > 0 ? involved : [n], FOCUS_PADDING);
    // 너무 확대되지 않도록 fitBox 기준 최소 1/6 폭은 유지.
    const minW = fitBox.w / 6;
    if (box.w < minW) {
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      const ratio = minW / box.w;
      box.w = minW;
      box.h *= ratio;
      box.x = cx - box.w / 2;
      box.y = cy - box.h / 2;
    }
    animateTo(box);
  };

  // 빈 캔버스(노드가 아닌 배경) 클릭 시 포커스 해제 + 전체 보기로 복귀.
  const handleBackgroundClick: React.MouseEventHandler<SVGSVGElement> = (e) => {
    if (e.target !== e.currentTarget) return;
    if (focusedId == null) return;
    setFocusedId(null);
    animateTo(fitBox);
  };

  const hoveredNode = laidOut.nodes.find((n) => n.id === hovered);
  const focusedNeighbors = focusedId ? neighborsOf.get(focusedId) ?? new Set<string>() : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">
          유사도 top-8 edge 로 이은 KB 전체 그래프입니다. 휠로 줌인/줌아웃, 드래그로 이동,
          노드를 클릭하면 이웃이 강조되고, 한 번 더 클릭하면 상세뷰로 이동합니다. edge 는
          5분마다 자동 재계산됩니다.
        </p>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="min-w-[3.5rem] rounded-md border bg-muted px-2 py-1 text-center text-xs font-medium tabular-nums text-muted-foreground">
            {zoomPct}%
          </span>
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

      {legend.length > 0 && (
        <div className="grid grid-cols-5 gap-x-3 gap-y-2 rounded-lg border bg-muted/20 px-3 py-2.5 text-sm text-muted-foreground">
          {legend.map(([label, count]) => (
            <span key={label} className="inline-flex min-w-0 items-center gap-1.5">
              <span
                className="inline-block size-3 shrink-0 rounded-full"
                style={{ backgroundColor: `hsl(${clusterHue(label)} 60% 55%)` }}
              />
              <span className="truncate">{label}</span>
              <span className="shrink-0 tabular-nums">{count}</span>
            </span>
          ))}
        </div>
      )}

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
          ref={attachContainer}
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
            onClick={handleBackgroundClick}
          >
            {laidOut.links.map((l, i) => {
              const s = l.source as unknown as GraphNode;
              const t = l.target as unknown as GraphNode;
              const touchesFocus =
                focusedId != null && (s.id === focusedId || t.id === focusedId);
              return (
                <line
                  key={i}
                  x1={s.x}
                  y1={s.y}
                  x2={t.x}
                  y2={t.y}
                  stroke={touchesFocus ? "#22c55e" : "currentColor"}
                  strokeOpacity={
                    touchesFocus ? 0.7 : focusedId != null ? 0.05 : 0.1 + l.score * 0.3
                  }
                  strokeWidth={touchesFocus ? 1.5 : 1}
                  className={touchesFocus ? undefined : "text-muted-foreground"}
                />
              );
            })}
            {laidOut.nodes.map((n) => {
              const hue = clusterHue(primaryClusterLabel(n.info));
              const r = nodeRadius(contributionUnits(n.info));
              const isHovered = hovered === n.id;
              const isFocused = focusedId === n.id;
              const isFocusedNeighbor = !isFocused && !!focusedNeighbors?.has(n.id);
              const dimmed = focusedId != null && !isFocused && !isFocusedNeighbor;

              let stroke = "var(--card)";
              let strokeWidth = 1.5;
              if (isFocused) {
                stroke = "#facc15";
                strokeWidth = 3;
              } else if (isFocusedNeighbor) {
                stroke = "#22c55e";
                strokeWidth = 2.5;
              }

              const showLabel = zoomed || isHovered;
              const keywords = showLabel ? nodeKeywords(n.info) : [];

              return (
                <g
                  key={n.id}
                  className="cursor-pointer"
                  opacity={dimmed ? 0.3 : 1}
                  onMouseEnter={() => setHovered(n.id)}
                  onMouseLeave={() => setHovered((h) => (h === n.id ? null : h))}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleNodeClick(n);
                  }}
                >
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={isHovered ? r + 4 : r}
                    fill={`hsl(${hue} 60% 55%)`}
                    stroke={stroke}
                    strokeWidth={strokeWidth}
                    opacity={isHovered ? 1 : 0.9}
                  />
                  {keywords.length > 0 && (
                    <text
                      x={n.x}
                      y={(n.y ?? 0) + r + 12}
                      textAnchor="middle"
                      className={
                        isHovered
                          ? "fill-foreground text-[9px] font-medium"
                          : "fill-muted-foreground text-[9px]"
                      }
                    >
                      {keywords.join(" · ")}
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
                <span className="ml-auto text-muted-foreground">이웃 {hoveredNode.degree}개 · 클릭해서 강조</span>
              </div>
              {(() => {
                const { question, answer, comment } = parseBundleContent(hoveredNode.info.content);
                return (
                  <div className="min-w-0">
                    <p className="truncate text-foreground">
                      <span className="text-xs font-medium text-muted-foreground">질문 · </span>
                      {question || "—"}
                    </p>
                    <p className="truncate text-muted-foreground">
                      <span className="text-xs font-medium">AI 답변 · </span>
                      {answer || "—"}
                    </p>
                    <p className="truncate text-foreground">
                      <span className="text-xs font-medium text-brand-green">세무사 코멘트 · </span>
                      {comment || "—"}
                    </p>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
