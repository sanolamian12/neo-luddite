"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Link2, Link2Off, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuditStore } from "@/lib/audit-store";
import { volumeLabel, SCORE_CATEGORY_LABELS } from "@/lib/audit-schema";
import { getConversation } from "@/lib/load-conversation";
import { formatDateTime } from "@/lib/poc-format";
import * as ragService from "@/services/rag";
import type { PassageInfo } from "@/services/rag";

/**
 * 배선실 (정성 평가) — RAG 에 실린 **세션 총평**을 추적한다.
 *
 * 문장 단위 배선실과 같은 축이되 실린 물건이 다르다: 저기는 문장 코멘트 번들,
 * 여기는 총평 + 두 점수(source_kind='session_eval', 0015). 총평은 (대화, 세무사)당
 * 1건이라 passage 도 1건 — 목록의 한 행이 곧 하나의 passage 다.
 */

interface EvalShipment {
  passage: PassageInfo;
  conversationId: string;
  auditorId: string;
  title: string;
  /** 실린 총평 원문 — audit-store 에서 해소(passage content 는 점수·머리말이 섞여 있다). */
  qualitative: string;
  scores: { writing: number; legalAccuracy: number } | null;
}

export function PackagingEvalListView() {
  const [passages, setPassages] = useState<PassageInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const evaluations = useAuditStore((s) => s.evaluations);

  const load = useCallback(async () => {
    try {
      const data = await ragService.listPassages(undefined, "session_eval");
      setPassages(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPassages([]);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const data = await ragService.listPassages(undefined, "session_eval");
        if (!ignore) {
          setPassages(data);
          setError(null);
        }
      } catch (e) {
        if (!ignore) {
          setError(e instanceof Error ? e.message : String(e));
          setPassages([]);
        }
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  const rows = useMemo<EvalShipment[]>(() => {
    return (passages ?? []).map((p) => {
      const conversationId = p.conversationId ?? "(대화 없음)";
      const auditorId = p.auditorId ?? p.reviewer ?? "?";
      const evaluation = evaluations.find(
        (e) =>
          e.conversationId === conversationId && e.auditorId === auditorId,
      );
      return {
        passage: p,
        conversationId,
        auditorId,
        title: getConversation(conversationId)?.topic.title ?? conversationId,
        qualitative: evaluation?.qualitative ?? "",
        scores: evaluation?.scores ?? null,
      };
    });
  }, [passages, evaluations]);

  const setStatus = async (id: string, next: "active" | "retired") => {
    setBusy(true);
    setError(null);
    try {
      await ragService.retractPassages([id], next);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Workflow className="size-6 text-brand-green" />
            배선실 — 정성 평가
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            검수실 (정성 평가) 에서 인정·최종 승인된 세션 총평이 RAG 에 실린 기록입니다.
            연결을 끊으면 검색에서 빠지되 기록은 보존됩니다(삭제 아님).
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={busy}
        >
          <RefreshCw className="size-3.5" />
          새로고침
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
          <p className="mt-1 text-xs text-muted-foreground">
            (배선실은 백엔드(Seam A)를 통해 rag.* 를 읽습니다. 백엔드가 떠 있는지
            확인하세요.)
          </p>
        </div>
      )}

      <div className="rounded-xl border bg-card">
        {passages === null ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            로딩 중…
          </p>
        ) : rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            아직 RAG 에 실린 정성 평가가 없습니다. 검수실 (정성 평가) 에서 인정한 총평을
            최종 승인하면 여기로 들어옵니다.
          </p>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => {
              const active = r.passage.status === "active";
              const open = openId === r.passage.id;
              return (
                <li key={r.passage.id} className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : r.passage.id)}
                    className="flex flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-muted/30"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{r.title}</p>
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {r.auditorId}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {volumeLabel(r.qualitative.trim().length)}
                    </span>
                    {r.scores && (
                      <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                        문장 {r.scores.writing}/5 · 법률{" "}
                        {r.scores.legalAccuracy}/5
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDateTime(r.passage.createdAt)}
                    </span>
                    <Badge variant={active ? "default" : "secondary"}>
                      {active ? "연결됨" : "연결 해제"}
                    </Badge>
                  </button>

                  {open && (
                    <div className="flex flex-col gap-3 border-t bg-muted/20 px-4 py-3">
                      {r.scores && (
                        <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
                          {(
                            [
                              ["writing", r.scores.writing],
                              ["legalAccuracy", r.scores.legalAccuracy],
                            ] as const
                          ).map(([key, value]) => (
                            <div
                              key={key}
                              className="rounded-md border bg-card px-3 py-2"
                            >
                              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                {SCORE_CATEGORY_LABELS[key]}
                              </p>
                              <p className="mt-0.5 text-lg font-semibold tabular-nums">
                                {value}
                                <span className="text-sm font-normal text-muted-foreground">
                                  /5
                                </span>
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          세션 전체 평가의견
                        </p>
                        <p className="mt-1 whitespace-pre-wrap rounded-md bg-card px-3 py-2 text-sm leading-relaxed">
                          {r.qualitative.trim() || r.passage.content}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant={active ? "destructive" : "default"}
                          onClick={() =>
                            setStatus(r.passage.id, active ? "retired" : "active")
                          }
                          disabled={busy}
                        >
                          {active ? (
                            <Link2Off className="size-3.5" />
                          ) : (
                            <Link2 className="size-3.5" />
                          )}
                          {busy ? "처리 중…" : active ? "연결 끊기" : "연결하기"}
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
