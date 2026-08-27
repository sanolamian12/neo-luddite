"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CopyCheck, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/poc-format";
import { cn } from "@/lib/utils";
import * as ragService from "@/services/rag";
import type { DuplicateCluster, PassageInfo } from "@/services/rag";

/**
 * 소급 중복 정리 (§3.1, 2026-08-27 구조 분석의 최우선 항목) — dedup 사전검토는 신규
 * 유입만 막는다. 이 화면은 이미 KB(rag.passages)에 실린 것 중 유사도 0.85 이상으로
 * 서로 연결된 클러스터를 배치 조회해 admin 에게 보여주고, 사람이 남길 것/뺄 것을
 * 고른 뒤 기존 연결끊기(retract) 경로로 그대로 정리한다. 삭제가 아니라 status 전환이라
 * 추적 로그는 보존되고, 정산 기여도(activeCount) 집계에서 즉시 빠진다.
 *
 * 프로덕션 KB(526건, 2026-08-27)로 실측한 결과, 의미 유사도 0.85 클러스터에는 서로 다른
 * 성격의 항목이 섞여 들어온다:
 *   1) 같은 conversationId+segmentId 에 다른 feedback_id 로 코멘트가 두 번 실린 경우
 *      (더블클릭/재시도로 짧은 간격에 재제출) — 이게 진짜 §3.1 중복.
 *   2) 같은 대화의 **다른** segment 에 달린 정당한 별개 코멘트 — 질문(A)이 번들 텍스트를
 *      지배해서 코사인 유사도가 높게 나올 뿐, 콘텐츠(C)는 서로 다르다.
 *   3) 서로 다른 대화(합성 시나리오라 문구가 비슷)인데 우연히 유사 — 명백한 오탐.
 * union-find 로 클러스터를 transitively 묶다 보니 2)·3)이 1) 주변에 딸려 들어와 7~9건
 * 클러스터가 흔하다. 그래서 "같은 segment 를 공유하는 항목"만 기본 체크하고, 나머지는
 * 사람이 직접 판단하도록 비워 둔다 — 클러스터 전체를 자동으로 정리 대상 취급하지 않는다.
 */
export function RagDuplicatesView() {
  const [threshold] = useState(0.85);
  const [clusters, setClusters] = useState<DuplicateCluster[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyCluster, setBusyCluster] = useState<string | null>(null);
  const [dbConfigured, setDbConfigured] = useState(true);

  const sortedClusters = useMemo(() => {
    return (clusters ?? []).map((c) => ({
      ...c,
      passages: [...c.passages].sort((a, b) => a.createdAt - b.createdAt),
    }));
  }, [clusters]);

  /** conversationId+segmentId 가 같은 passage 끼리 묶는다 — 이 그룹만 "진짜 재제출" 신호. */
  const segmentGroups = (passages: PassageInfo[]): Map<string, PassageInfo[]> => {
    const map = new Map<string, PassageInfo[]>();
    for (const p of passages) {
      if (!p.segmentId || !p.conversationId) continue;
      const key = `${p.conversationId}::${p.segmentId}`;
      const arr = map.get(key) ?? [];
      arr.push(p);
      map.set(key, arr);
    }
    return map;
  };

  /** 이 passage 가 같은 클러스터 안에서 동일 segment 를 공유하는 다른 항목이 있는가. */
  const isSameSegmentDuplicate = (p: PassageInfo, cluster: DuplicateCluster): boolean => {
    if (!p.segmentId || !p.conversationId) return false;
    const siblings = cluster.passages.filter(
      (q) => q.conversationId === p.conversationId && q.segmentId === p.segmentId,
    );
    return siblings.length > 1;
  };

  const defaultSelection = (cluster: DuplicateCluster): Set<string> => {
    const toCheck = new Set<string>();
    for (const group of segmentGroups(cluster.passages).values()) {
      if (group.length < 2) continue; // 단독이면 재제출 신호 아님 — 자동 선택 안 함
      const byAge = [...group].sort((a, b) => a.createdAt - b.createdAt);
      // 같은 segment 재제출 그룹 안에서만 가장 오래된 것을 원본으로 남기고 나머지 체크.
      for (const p of byAge.slice(1)) toCheck.add(p.id);
    }
    return toCheck;
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await ragService.listDuplicateClusters(threshold);
      setClusters(res.clusters);
      setDbConfigured(res.dbConfigured);
      const initial = new Set<string>();
      for (const c of res.clusters) {
        for (const id of defaultSelection(c)) initial.add(id);
      }
      setSelected(initial);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setClusters([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clusterKey = (c: DuplicateCluster) => c.ids.slice().sort().join(",");

  const retireCluster = async (cluster: DuplicateCluster) => {
    const ids = cluster.passages.map((p) => p.id).filter((id) => selected.has(id));
    if (ids.length === 0) return;
    setBusyCluster(clusterKey(cluster));
    setError(null);
    try {
      await ragService.retractPassages(ids, "retired");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyCluster(null);
    }
  };

  return (
    <div className="flex flex-col gap-5 px-6 py-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <CopyCheck className="size-6 text-brand-amber" />
            소급 중복 정리
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            KB 에 이미 실린 passage 중 유사도 {Math.round(threshold * 100)}% 이상으로 서로
            연결된 클러스터입니다. dedup 사전검토(검수실)는 신규 유입만 막으므로, 그 전에
            들어온 중복은 여기서 확인 후 수동으로 연결끊기(retired)합니다. 삭제가 아니라
            상태 전환이라 추적 기록은 남고, 정산 기여도 집계에서는 즉시 빠집니다.
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            같은 질문에 달린 코멘트는 전부 여기 묶여 보이지만, 그중 <strong>같은 문장(segment)에
            중복 제출</strong>된 것만 기본으로 체크되어 있습니다. 다른 문장에 달린 별개
            코멘트나 서로 다른 대화가 우연히 비슷한 경우는 정당한 기여일 수 있으니 직접
            확인 후 선택하세요.
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

      {!dbConfigured && !loading && (
        <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
          <AlertTriangle className="size-4" />
          RAG DB 미설정 — 조회 결과가 없습니다.
        </div>
      )}

      {loading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">로딩 중…</p>
      ) : sortedClusters.length === 0 ? (
        <div className="rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          유사도 {Math.round(threshold * 100)}% 이상 클러스터가 없습니다. 소급 중복이 없거나
          이미 정리됐습니다.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {sortedClusters.map((cluster) => {
            const key = clusterKey(cluster);
            const checkedCount = cluster.passages.filter((p) => selected.has(p.id)).length;
            return (
              <section key={key} className="overflow-hidden rounded-xl border bg-card">
                <header className="flex items-center justify-between gap-3 border-b px-4 py-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono">
                      최대 유사도 {(cluster.maxScore * 100).toFixed(1)}%
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {cluster.passages.length}건 상호 연결
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={checkedCount === 0 || busyCluster === key}
                    onClick={() => void retireCluster(cluster)}
                  >
                    선택 {checkedCount}건 연결끊기(retired)
                  </Button>
                </header>
                <ul className="divide-y">
                  {cluster.passages.map((p: PassageInfo, idx) => {
                    const sameSegment = isSameSegmentDuplicate(p, cluster);
                    return (
                    <li key={p.id} className="flex items-start gap-3 px-4 py-3">
                      <input
                        type="checkbox"
                        className="mt-1 size-4 shrink-0"
                        checked={selected.has(p.id)}
                        onChange={() => toggle(p.id)}
                        aria-label={`${p.id} 정리 대상으로 선택`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {idx === 0 && (
                            <Badge variant="outline" className="text-brand-green">
                              원본(가장 오래됨)
                            </Badge>
                          )}
                          {sameSegment ? (
                            <Badge variant="outline" className="border-destructive/40 text-destructive">
                              동일 문장 재제출 의심
                            </Badge>
                          ) : (
                            <Badge variant="outline">유사 — 수동 확인 필요</Badge>
                          )}
                          <span className="font-mono">{p.sourceKind}</span>
                          <span>·</span>
                          <span>{p.reviewer ?? "—"}</span>
                          <span>·</span>
                          <span>{formatDateTime(p.createdAt)}</span>
                          <span
                            className={cn(
                              "ml-auto rounded px-1.5 py-0.5",
                              p.status === "active"
                                ? "bg-brand-green/10 text-brand-green"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {p.status === "active" ? "활성" : "연결끊김"}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-foreground">
                          {p.content}
                        </p>
                      </div>
                    </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
