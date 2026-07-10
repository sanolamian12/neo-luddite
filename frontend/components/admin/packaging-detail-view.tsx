"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { getConversation } from "@/lib/load-conversation";
import { FEEDBACK_TAG_LABELS, type FeedbackTag } from "@/lib/audit-schema";
import { formatDateTime } from "@/lib/poc-format";
import { middleTruncate } from "@/lib/utils";
import * as ragService from "@/services/rag";
import type { PassageInfo } from "@/services/rag";

function tagLabel(t: string): string {
  return FEEDBACK_TAG_LABELS[t as FeedbackTag] ?? t;
}

export function PackagingDetailView({ conversationId }: { conversationId: string }) {
  const [passages, setPassages] = useState<PassageInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const title = getConversation(conversationId)?.topic.title ?? conversationId;

  const load = useCallback(async () => {
    try {
      const data = await ragService.listPassages(conversationId);
      setPassages(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPassages([]);
    }
  }, [conversationId]);

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const data = await ragService.listPassages(conversationId);
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
  }, [conversationId]);

  const summary = useMemo(() => {
    const ps = passages ?? [];
    const active = ps.filter((p) => p.status === "active").length;
    const byReviewer = new Map<string, { active: number; retired: number }>();
    for (const p of ps) {
      const key = p.reviewer ?? p.auditorId ?? "?";
      const v = byReviewer.get(key) ?? { active: 0, retired: 0 };
      if (p.status === "active") v.active += 1;
      else v.retired += 1;
      byReviewer.set(key, v);
    }
    return { total: ps.length, active, retired: ps.length - active, byReviewer };
  }, [passages]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const setStatus = async (ids: string[], status: "retired" | "active") => {
    if (ids.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await ragService.retractPassages(ids, status);
      setSelected(new Set());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 px-6 py-6 max-w-4xl">
      <div className="flex flex-col gap-1">
        <Link
          href="/admin/packaging"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          배선실 목록
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="font-mono text-xs text-muted-foreground">
          <span title={conversationId}>{middleTruncate(conversationId)}</span>
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* 요약: 참여 세무사별 코멘트 수 */}
      <section className="rounded-xl border bg-card">
        <header className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="text-sm font-semibold">참여 세무사 · 적재 현황</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            연결 {summary.active} · 끊김 {summary.retired} / 총 {summary.total}
          </span>
        </header>
        <ul className="divide-y text-sm">
          {[...summary.byReviewer.entries()].map(([reviewer, v]) => (
            <li key={reviewer} className="flex items-center justify-between px-4 py-2">
              <span className="font-medium">{reviewer}</span>
              <span className="tabular-nums text-xs text-muted-foreground">
                코멘트 {v.active + v.retired}건
                {v.retired > 0 && ` (연결 ${v.active} · 끊김 ${v.retired})`}
              </span>
            </li>
          ))}
          {summary.byReviewer.size === 0 && passages !== null && (
            <li className="px-4 py-6 text-center text-muted-foreground">
              이 대화에서 RAG 로 실린 코멘트가 없습니다.
            </li>
          )}
        </ul>
      </section>

      {/* 일괄 조작 */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <span>{selected.size}건 선택</span>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setStatus([...selected], "retired")}
              disabled={busy}
            >
              연결 끊기
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setStatus([...selected], "active")}
              disabled={busy}
            >
              재연결
            </Button>
          </div>
        </div>
      )}

      {/* passage 추적 로그 — RAG 에 어디에/어떻게 꽂혀있는가 */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">RAG 추적 로그 ({summary.total})</h2>
        {passages === null ? (
          <p className="text-sm text-muted-foreground">로딩 중…</p>
        ) : (
          passages.map((p) => {
            const retired = p.status === "retired";
            return (
              <div
                key={p.id}
                className={
                  "rounded-xl border bg-card p-3 text-sm" +
                  (retired ? " opacity-60" : "")
                }
              >
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected.has(p.id)}
                    onChange={() => toggle(p.id)}
                    aria-label="passage 선택"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={retired ? "secondary" : "default"}>
                        {retired ? "연결 끊김" : "연결됨"}
                      </Badge>
                      <span className="text-xs font-medium">
                        {p.reviewer ?? p.auditorId}
                      </span>
                      {p.auditorId && (
                        <span className="text-[10px] text-muted-foreground">
                          ({p.auditorId})
                        </span>
                      )}
                      {p.feedbackTags.map((t) => (
                        <Badge key={t} variant="outline" className="text-[10px]">
                          {tagLabel(t)}
                        </Badge>
                      ))}
                    </div>
                    <pre className="mt-2 whitespace-pre-wrap break-words rounded-md bg-muted px-2 py-1.5 text-xs font-sans leading-relaxed">
                      {p.content}
                    </pre>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                      <span title={p.id}>uuid {middleTruncate(p.id)}</span>
                      <span title={p.dedupeKey}>key {middleTruncate(p.dedupeKey)}</span>
                      {p.taxCategory && <span>세목 {p.taxCategory}</span>}
                      <span>적재 {formatDateTime(p.createdAt)}</span>
                      {/* 모바일: 축약된 메타 전체를 팝업으로 (좁은 화면 대응) */}
                      <Dialog>
                        <DialogTrigger
                          render={
                            <Button
                              size="xs"
                              variant="ghost"
                              className="h-5 gap-1 px-1.5 text-[10px] md:hidden"
                            />
                          }
                        >
                          <Info className="size-3" />
                          상세
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Passage 상세</DialogTitle>
                          </DialogHeader>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant={retired ? "secondary" : "default"}>
                              {retired ? "연결 끊김" : "연결됨"}
                            </Badge>
                            <span className="text-xs font-medium">
                              {p.reviewer ?? p.auditorId}
                            </span>
                            {p.feedbackTags.map((t) => (
                              <Badge key={t} variant="outline" className="text-[10px]">
                                {tagLabel(t)}
                              </Badge>
                            ))}
                          </div>
                          <pre className="whitespace-pre-wrap break-words rounded-md bg-muted px-2 py-1.5 text-xs font-sans leading-relaxed">
                            {p.content}
                          </pre>
                          <dl className="flex flex-col gap-1 text-xs text-muted-foreground">
                            <div className="flex flex-col">
                              <dt className="text-[10px] uppercase tracking-wider">uuid</dt>
                              <dd className="break-all font-mono text-foreground">{p.id}</dd>
                            </div>
                            <div className="flex flex-col">
                              <dt className="text-[10px] uppercase tracking-wider">dedupe key</dt>
                              <dd className="break-all font-mono text-foreground">{p.dedupeKey}</dd>
                            </div>
                            {p.auditorId && (
                              <div className="flex flex-col">
                                <dt className="text-[10px] uppercase tracking-wider">평가자</dt>
                                <dd className="break-all font-mono text-foreground">{p.auditorId}</dd>
                              </div>
                            )}
                            {p.taxCategory && (
                              <div>
                                <dt className="inline text-[10px] uppercase tracking-wider">세목 </dt>
                                <dd className="inline text-foreground">{p.taxCategory}</dd>
                              </div>
                            )}
                            <div>
                              <dt className="inline text-[10px] uppercase tracking-wider">적재 </dt>
                              <dd className="inline text-foreground">{formatDateTime(p.createdAt)}</dd>
                            </div>
                          </dl>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>
                  <Button
                    size="xs"
                    variant={retired ? "outline" : "destructive"}
                    onClick={() => setStatus([p.id], retired ? "active" : "retired")}
                    disabled={busy}
                  >
                    {retired ? "재연결" : "연결 끊기"}
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
