"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Link2, Link2Off } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuditStore, evaluationFor } from "@/lib/audit-store";
import {
  FEEDBACK_TAG_LABELS,
  SCORE_CATEGORY_LABELS,
  type FeedbackTag,
} from "@/lib/audit-schema";
import { getConversation } from "@/lib/load-conversation";
import { formatDateTime } from "@/lib/poc-format";
import * as ragService from "@/services/rag";
import type { PassageInfo } from "@/services/rag";

/**
 * 배선실 (문장 단위) 상세 — 한 세무사가 한 대화에 실은 문장 코멘트 묶음.
 *
 * 위: 실제로 RAG 에 실린 질문·답변·코멘트 번들.
 * 아래: 그 세무사가 같은 대화에 남긴 세션 평가(총평·점수) — 이 코멘트들이 어떤 판단
 *       아래에서 나왔는지의 맥락. (정성 평가 자체의 적재 추적은 배선실 (정성 평가).)
 *
 * 연결 상태는 토글 하나로 다룬다: [연결됨]↔[연결 해제], [연결 끊기]↔[연결하기].
 */

function tagLabel(t: string): string {
  return FEEDBACK_TAG_LABELS[t as FeedbackTag] ?? t;
}

/** 번들 content 를 [질문]/[AI 답변]/[세무사 코멘트] 절로 쪼갠다(백엔드 build_bundle_text 형식). */
function splitBundle(content: string): { label: string; text: string }[] {
  const out: { label: string; text: string }[] = [];
  const re = /\[(질문|AI 답변|세무사 코멘트)\]\s*/g;
  const marks = [...content.matchAll(re)];
  if (marks.length === 0) return [{ label: "내용", text: content }];
  marks.forEach((m, i) => {
    const start = m.index! + m[0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index! : content.length;
    out.push({ label: m[1], text: content.slice(start, end).trim() });
  });
  return out;
}

export function PackagingDetailView({
  conversationId,
  auditorId,
}: {
  conversationId: string;
  auditorId?: string;
}) {
  const [passages, setPassages] = useState<PassageInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const evaluations = useAuditStore((s) => s.evaluations);

  const title = getConversation(conversationId)?.topic.title ?? conversationId;

  const fetchPassages = useCallback(
    () => ragService.listPassages(conversationId, "feedback"),
    [conversationId],
  );

  const load = useCallback(async () => {
    try {
      setPassages(await fetchPassages());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPassages([]);
    }
  }, [fetchPassages]);

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const data = await fetchPassages();
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
  }, [fetchPassages]);

  // auditorId 를 주면 그 세무사 몫만(목록이 Task×세무사 단위이므로 기본 경로).
  const mine = useMemo(() => {
    const ps = passages ?? [];
    if (!auditorId) return ps;
    return ps.filter((p) => (p.auditorId ?? p.reviewer) === auditorId);
  }, [passages, auditorId]);

  const activeCount = mine.filter((p) => p.status === "active").length;
  const allRetired = mine.length > 0 && activeCount === 0;
  const reviewer = mine[0]?.reviewer ?? auditorId ?? "";

  const evaluation = auditorId
    ? evaluationFor(evaluations, conversationId, auditorId)
    : null;

  // 토글: 하나라도 살아 있으면 [연결 끊기], 전부 끊겼으면 [연결하기].
  const onToggle = async () => {
    if (mine.length === 0 || busy) return;
    const next = allRetired ? "active" : "retired";
    const ids = mine
      .filter((p) => (next === "active" ? p.status === "retired" : p.status === "active"))
      .map((p) => p.id);
    if (ids.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await ragService.retractPassages(ids, next);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/admin/packaging"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
          >
            <ArrowLeft className="size-3.5" />
            배선실 (문장 단위)
          </Link>
          <h1 className="mt-1 truncate text-2xl font-bold tracking-tight">
            {title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {reviewer ? `세무사 ${reviewer} · ` : ""}적재 {mine.length}건 (연결{" "}
            {activeCount} · 끊김 {mine.length - activeCount})
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant={allRetired ? "secondary" : "default"}>
            {allRetired ? "연결 해제" : "연결됨"}
          </Badge>
          <Button
            size="sm"
            variant={allRetired ? "default" : "destructive"}
            onClick={onToggle}
            disabled={busy || mine.length === 0}
          >
            {allRetired ? (
              <Link2 className="size-3.5" />
            ) : (
              <Link2Off className="size-3.5" />
            )}
            {busy ? "처리 중…" : allRetired ? "연결하기" : "연결 끊기"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* 위: 질문과 답변(+코멘트) — 실제로 RAG 에 실린 번들 */}
      <section className="rounded-xl border bg-card">
        <h2 className="border-b px-4 py-2.5 text-sm font-semibold">
          질문 · 답변 · 코멘트
        </h2>
        {passages === null ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            로딩 중…
          </p>
        ) : mine.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            이 세무사가 이 대화에서 RAG 에 실은 코멘트가 없습니다.
          </p>
        ) : (
          <ul className="divide-y">
            {mine.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={p.status === "active" ? "default" : "secondary"}
                    className="text-[10px]"
                  >
                    {p.status === "active" ? "연결됨" : "연결 해제"}
                  </Badge>
                  {p.feedbackTags.map((t) => (
                    <Badge key={t} variant="outline" className="text-[10px]">
                      {tagLabel(t)}
                    </Badge>
                  ))}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatDateTime(p.createdAt)}
                  </span>
                </div>
                <dl className="flex flex-col gap-1.5">
                  {splitBundle(p.content).map((part, i) => (
                    <div key={i}>
                      <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        {part.label}
                      </dt>
                      <dd className="whitespace-pre-wrap text-sm leading-relaxed">
                        {part.text}
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 아래: 세션 평가 — 이 코멘트들이 어떤 판단 아래에서 나왔는지 */}
      <section className="rounded-xl border bg-card">
        <h2 className="border-b px-4 py-2.5 text-sm font-semibold">세션 평가</h2>
        {!evaluation ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {auditorId
              ? "이 세무사의 세션 평가가 없습니다."
              : "세무사를 지정하면 그 세무사의 세션 평가를 보여줍니다."}
          </p>
        ) : (
          <div className="flex flex-col gap-3 p-4">
            <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
              {(
                [
                  ["writing", evaluation.scores.writing],
                  ["legalAccuracy", evaluation.scores.legalAccuracy],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="rounded-md border bg-muted/30 px-3 py-2">
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
            {evaluation.qualitative.trim() ? (
              <p className="whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-sm leading-relaxed">
                {evaluation.qualitative}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                작성된 총평이 없습니다.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
