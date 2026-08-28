"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Network, RefreshCw, Search, Waypoints, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/poc-format";
import { clusterHue, sourceKindMeta, UNCLASSIFIED } from "@/lib/kb-cluster-colors";
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

type Axis = "taxCategory" | "occupation" | "sourceKind";

const AXIS_LABEL: Record<Axis, string> = {
  taxCategory: "세목",
  occupation: "직업군",
  sourceKind: "유형",
};

function clusterKey(p: PassageInfo, axis: Axis): string {
  if (axis === "sourceKind") return sourceKindMeta(p.sourceKind).label;
  const v = p[axis];
  return v && v.trim() ? v : UNCLASSIFIED;
}

// 세목 카테고리 한줄 설명 — backend/api/llm.py: _CLASSIFY_SYSTEM 의 분류 기준과 동일 문구로 유지.
// 분류 기준이 바뀌면 여기도 같이 갱신할 것.
const TAX_CATEGORY_DESC: Record<string, string> = {
  "업무용승용차": "차량 구입·리스·유지비 등 업무용 등록 차량 관련 지출",
  "임차료": "오피스텔·사무공간·병원건물 임대료, 임대차계약, 원상복구비",
  "접대성지출": "거래처 선물·골프·식사 등 특정 상대방을 대상으로 한 접대",
  "광고선전비": "인플루언서 마케팅, SNS·유튜브 홍보, 경품 등 불특정다수 대상 광고",
  "통신비": "휴대폰·인터넷 요금",
  "복리후생비": "직원 워크숍·경조사비·명절선물·헬스장·식대 등 급여가 아닌 후생 혜택",
  "출장비": "학회·해외출장·연수 경비(항공·숙박·식대)",
  "소프트웨어구독": "AI·SaaS·클라우드 구독료",
  "가사관련비": "원장 개인·자택 관련 지출(자택 사무공간, 개인용 휴대폰 등)",
  "인건비·가족직원": "배우자·자녀·부모 등 가족 고용, 급여, 4대보험 미가입, 프리랜서·근로자 구분",
  "퇴직금·4대보험": "퇴직금 중간정산·지급, 4대보험 가입·정지, 고용증대세액공제, 육아휴직 대체인력",
  "시설·인테리어": "인테리어 공사·장비 구매·리스·감가상각·즉시상각, 수선비 vs 자산 판단",
  "부가가치세": "부가세 신고, 간이과세자, 면세사업자, 매입세액공제, 대리납부, 폐업재고 부가세, 세금계산서",
  "상속·증여": "자녀·배우자 명의 증여(펀드·부동산), 종신보험 수익자 지정을 통한 상속·증여 설계",
  "소득세·법인전환·개원폐업":
    "법인전환, 종합소득세, 노란우산·IRP·연금저축, 강사료·인세 등 기타소득, 개원 준비비용, 폐업, 공동개원 동업 정산",
  "매출관리": "현금매출 누락, 진료비 할인·면제, 매출 신고 누락, 비대면진료 매출 구분",
  "기타":
    "위 카테고리 어디에도 안 맞지만 세무 관련 내용은 맞는 경우(기부금·보험금·대손·행정규정 등) — AI가 적극적으로 고른 결과",
};

const UNCLASSIFIED_TAX_DESC =
  "AI가 17개 카테고리(기타 포함) 중 어느 것도 확신 있게 고르지 못한 경우(분류 실패·API 오류) 또는 실질적 세무 내용이 없는 단순 follow-up — '기타'와 달리 적극적으로 고른 결과가 아니라 분류가 보류된 상태";

const SOURCE_KIND_DESC: Record<string, string> = {
  "세무사 코멘트": "검수실에서 세무사가 문장 단위로 남긴 코멘트가 배선된 항목",
  "세션 총평": "상담 세션 전체에 대한 세무사 정성 평가가 배선된 항목",
  "판례 시드": "초기 KB 구축 시 심어둔 판례 시드 데이터",
  "큐레이션 문서": "직접 큐레이션해 등록한 참고 문서",
};

const OCCUPATION_DESC: Record<string, string> = {
  clinic: "병의원(개원의) 대상 세무 상담",
};

function describeCluster(axis: Axis, key: string): string | null {
  if (key === UNCLASSIFIED) {
    if (axis === "taxCategory") return UNCLASSIFIED_TAX_DESC;
    return "이 축의 메타데이터 값이 비어 있는 항목";
  }
  if (axis === "taxCategory") return TAX_CATEGORY_DESC[key] ?? null;
  if (axis === "sourceKind") return SOURCE_KIND_DESC[key] ?? null;
  if (axis === "occupation") return OCCUPATION_DESC[key] ?? null;
  return null;
}

type ViewMode = "clusters" | "graph";

const PAGE_SIZE = 20;

function matchesSearch(p: PassageInfo, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    p.content.toLowerCase().includes(needle) ||
    p.feedbackTags.some((t) => t.toLowerCase().includes(needle)) ||
    (p.reviewer ?? "").toLowerCase().includes(needle) ||
    (p.auditorId ?? "").toLowerCase().includes(needle)
  );
}

function PaginationBar({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-3 border-t px-4 py-2">
      <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        이전
      </Button>
      <span className="text-xs text-muted-foreground tabular-nums">
        {page} / {totalPages} 페이지
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        다음
      </Button>
    </div>
  );
}

function PassageListItem({
  p,
  clusterAxis,
}: {
  p: PassageInfo;
  /** 지정하면 항목 맨 앞에 이 축 기준 뿌리 클러스터를 색깔 태그로 붙인다(검색 결과용). */
  clusterAxis?: Axis;
}) {
  const meta = sourceKindMeta(p.sourceKind);
  const rootCluster = clusterAxis ? clusterKey(p, clusterAxis) : null;
  return (
    <li>
      <Link
        href={`/audit/kb-map/${encodeURIComponent(p.id)}`}
        className="flex flex-col gap-1.5 px-4 py-3 hover:bg-muted/30"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {rootCluster && (
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-white"
              style={{ backgroundColor: `hsl(${clusterHue(rootCluster)} 60% 55%)` }}
            >
              {rootCluster}
            </span>
          )}
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
          <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(p.createdAt)}</span>
        </div>
        <p className="line-clamp-2 text-sm text-foreground">{p.content}</p>
        <p className="text-xs text-muted-foreground">{p.reviewer ?? p.auditorId ?? "—"}</p>
      </Link>
    </li>
  );
}

export function KbMapView() {
  const [viewMode, setViewMode] = useState<ViewMode>("graph");
  const [passages, setPassages] = useState<PassageInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [axis, setAxis] = useState<Axis>("taxCategory");
  const [showRetired, setShowRetired] = useState(false);
  const [selectedCluster, setSelectedCluster] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    // 타이핑 중엔 필터링을 미루고, 0.5초간 입력이 멈추면 그때 실제 검색어에 반영한다.
    const timer = setTimeout(() => setSearch(searchInput), 500);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const clearSearch = () => {
    setSearchInput("");
    setSearch("");
  };

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
    // 가나다순이 기본. "기타"·"(미분류)"는 값 자체가 다른 클러스터와 못 겨루는 애매/잔여
    // 카테고리라 항상 맨 뒤(기타 → 미분류 순)로 보낸다.
    const tailRank = (key: string) => (key === "기타" ? 1 : key === UNCLASSIFIED ? 2 : 0);
    return [...byKey.entries()].sort((a, b) => {
      const ra = tailRank(a[0]);
      const rb = tailRank(b[0]);
      if (ra !== rb) return ra - rb;
      if (ra !== 0) return 0;
      return a[0].localeCompare(b[0], "ko");
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

  const searchActive = search.trim().length > 0;
  const searchResults = useMemo(
    () => (searchActive ? visible.filter((p) => matchesSearch(p, search)) : []),
    [visible, search, searchActive],
  );

  useEffect(() => {
    setPage(1);
  }, [search, selectedCluster, axis, showRetired]);

  const activeList = searchActive ? searchResults : shownPassages;
  const sortedActiveList = useMemo(
    () => [...activeList].sort((a, b) => b.createdAt - a.createdAt),
    [activeList],
  );
  const totalPages = Math.max(1, Math.ceil(sortedActiveList.length / PAGE_SIZE));
  const pagedList = sortedActiveList.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="KB 전체에서 검색 (질문·답변·세무사 코멘트·태그)"
              className="pl-8 pr-8"
            />
            {searchInput && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          {searchActive ? (
            <section className="rounded-xl border bg-card">
              <header className="flex items-center justify-between border-b px-4 py-2">
                <h2 className="text-sm font-semibold">
                  검색 결과 <span className="text-muted-foreground">· {searchResults.length}건</span>
                </h2>
                <Button size="sm" variant="ghost" onClick={clearSearch}>
                  지우기
                </Button>
              </header>
              {searchResults.length === 0 ? (
                <p className="px-4 py-12 text-center text-sm text-muted-foreground">
                  일치하는 항목이 없습니다.
                </p>
              ) : (
                <>
                  <ul className="divide-y">
                    {pagedList.map((p) => (
                      <PassageListItem key={p.id} p={p} clusterAxis={axis} />
                    ))}
                  </ul>
                  <PaginationBar page={page} totalPages={totalPages} onChange={setPage} />
                </>
              )}
            </section>
          ) : loading ? (
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
                      selected && "border-brand-green bg-brand-green/30",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold" title={key}>
                        {key}
                      </span>
                      <span
                        className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-semibold text-white"
                        style={{ backgroundColor: `hsl(${clusterHue(key)} 60% 55%)` }}
                      >
                        {ps.length}
                      </span>
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

          {!searchActive && selectedCluster && (
            <section className="rounded-xl border bg-card">
              <header className="flex items-center justify-between border-b px-4 py-2">
                <h2 className="text-sm font-semibold">
                  {selectedCluster} <span className="text-muted-foreground">· {shownPassages.length}건</span>
                </h2>
                <Button size="sm" variant="ghost" onClick={() => setSelectedCluster(null)}>
                  닫기
                </Button>
              </header>
              {describeCluster(axis, selectedCluster) && (
                <p className="border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
                  {describeCluster(axis, selectedCluster)}
                </p>
              )}
              <ul className="divide-y">
                {pagedList.map((p) => (
                  <PassageListItem key={p.id} p={p} />
                ))}
              </ul>
              <PaginationBar page={page} totalPages={totalPages} onChange={setPage} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
