"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PackageCheck, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getConversation } from "@/lib/load-conversation";
import { formatDateTime } from "@/lib/poc-format";
import * as ragService from "@/services/rag";
import type { PassageInfo } from "@/services/rag";

/** 대화(=방) 단위로 묶은 RAG 적재 데이터셋 요약. */
interface Shipment {
  conversationId: string;
  title: string;
  passages: PassageInfo[];
  activeCount: number;
  retiredCount: number;
  reviewers: string[]; // 참여 세무사 표시이름(중복 제거)
  latestAt: number;
}

function group(passages: PassageInfo[]): Shipment[] {
  const byConv = new Map<string, PassageInfo[]>();
  for (const p of passages) {
    const cid = p.conversationId ?? "(대화 없음)";
    const arr = byConv.get(cid) ?? [];
    arr.push(p);
    byConv.set(cid, arr);
  }
  const out: Shipment[] = [];
  for (const [conversationId, ps] of byConv) {
    const active = ps.filter((p) => p.status === "active").length;
    const reviewers = [...new Set(ps.map((p) => p.reviewer ?? p.auditorId ?? "?"))];
    out.push({
      conversationId,
      title: getConversation(conversationId)?.topic.title ?? conversationId,
      passages: ps,
      activeCount: active,
      retiredCount: ps.length - active,
      reviewers,
      latestAt: Math.max(...ps.map((p) => p.createdAt)),
    });
  }
  return out.sort((a, b) => b.latestAt - a.latestAt);
}

function statusBadge(s: Shipment): { label: string; variant: "default" | "outline" | "secondary" } {
  if (s.activeCount === 0) return { label: "끊김", variant: "secondary" };
  if (s.retiredCount > 0) return { label: "일부 끊김", variant: "outline" };
  return { label: "연결", variant: "default" };
}

export function PackagingListView() {
  const [passages, setPassages] = useState<PassageInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await ragService.listPassages();
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
        const data = await ragService.listPassages();
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

  const shipments = useMemo(() => (passages ? group(passages) : []), [passages]);

  const toggle = (cid: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cid)) next.delete(cid);
      else next.add(cid);
      return next;
    });

  // 선택된 대화들의 active passage id (연결끊기 대상)
  const selectedActiveIds = useMemo(() => {
    const ids: string[] = [];
    for (const s of shipments) {
      if (!selected.has(s.conversationId)) continue;
      for (const p of s.passages) if (p.status === "active") ids.push(p.id);
    }
    return ids;
  }, [shipments, selected]);

  const onRetract = async () => {
    if (selectedActiveIds.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await ragService.retractPassages(selectedActiveIds, "retired");
      setSelected(new Set());
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
            <PackageCheck className="size-6 text-brand-green" />
            포장실 — RAG 적재 추적
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            검수 확정으로 RAG 에 실린 데이터셋을 대화 단위로 추적합니다. 연결을 끊으면
            검색에서 빠지되 기록은 보존됩니다(삭제 아님).
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={busy}>
          <RefreshCw className="size-3.5" />
          새로고침
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
          <p className="mt-1 text-xs text-muted-foreground">
            (포장실은 백엔드(Seam A)를 통해 rag.* 를 읽습니다. 백엔드가 떠 있는지 확인하세요.)
          </p>
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <span>{selected.size}개 대화 선택 · 끊을 연결 {selectedActiveIds.length}건</span>
          <Button
            size="sm"
            variant="destructive"
            className="ml-auto"
            onClick={onRetract}
            disabled={busy || selectedActiveIds.length === 0}
          >
            {busy ? "처리 중…" : "선택 연결 끊기"}
          </Button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="w-10 px-3 py-2" />
              <th className="px-3 py-2 text-left font-medium">대화(방)</th>
              <th className="px-3 py-2 text-right font-medium">참여 세무사</th>
              <th className="px-3 py-2 text-right font-medium">적재 코멘트</th>
              <th className="px-3 py-2 text-left font-medium">최근 적재</th>
              <th className="px-3 py-2 text-right font-medium">상태</th>
            </tr>
          </thead>
          <tbody>
            {passages === null ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-muted-foreground">
                  로딩 중…
                </td>
              </tr>
            ) : shipments.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-muted-foreground">
                  아직 RAG 에 실린 데이터셋이 없습니다. 검수 확정 시 인정된 코멘트가 여기로
                  들어옵니다.
                </td>
              </tr>
            ) : (
              shipments.map((s) => {
                const badge = statusBadge(s);
                return (
                  <tr key={s.conversationId} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(s.conversationId)}
                        onChange={() => toggle(s.conversationId)}
                        aria-label={`${s.title} 선택`}
                      />
                    </td>
                    <td className="max-w-[360px] truncate px-3 py-2 font-medium">
                      <Link
                        href={`/admin/packaging/${encodeURIComponent(s.conversationId)}`}
                        className="hover:underline"
                      >
                        {s.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {s.reviewers.length}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {s.activeCount}
                      {s.retiredCount > 0 && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          (+{s.retiredCount} 끊김)
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {formatDateTime(s.latestAt)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
