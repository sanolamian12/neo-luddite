"use client";

import { useEffect, useState } from "react";
import { Check, RefreshCw, Share2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/poc-format";
import { LoadingBlock } from "@/components/ui/spinner";
import { listShareQueue, reviewShare, type ShareQueueItem } from "@/services/expert-kb3";

/**
 * 공용 KB 공유 승인 (0043, 2026-10-06) — 세무사가 스튜디오에서 '공용 KB 로 보내기'한 사례를 관리자가 승인·거부한다.
 * 승인 = 공용 KB3(모든 상담의 AI 답변 근거) + 그 세무사에게 크레딧 ledger 행(금액은 기획 미정 → 0원 기록).
 * 거부 = 공용에 안 올라가고 그 세무사의 전용 RAG(연결된 상담)에는 그대로 남는다.
 */
export function Kb3ShareView() {
  const [items, setItems] = useState<ShareQueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listShareQueue());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // 첫 조회 — rag-edits-view 와 같은 패턴(마운트 때 한 번 불러온다)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  const review = async (item: ShareQueueItem, approve: boolean) => {
    setBusyId(item.case.id);
    setError(null);
    setDone(null);
    try {
      await reviewShare(item.case.id, approve);
      setDone(approve
        ? `"${item.case.title}" 을(를) 공용 KB 에 올렸습니다 — 모든 상담에 쓰이고, 크레딧(금액 미정) 기록을 남겼습니다.`
        : `"${item.case.title}" 공유를 거부했습니다 — 세무사 전용 RAG 에는 그대로 남습니다.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-5 px-6 py-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><Share2 className="size-6" />공용 KB 공유 승인</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            세무사가 가르친 사례를 공용 KB 로 보낸 요청입니다. 승인하면 모든 상담의 AI 답변 근거가 되고, 그 세무사에게 크레딧이 기록됩니다(금액 기획 미정 · 0원).
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className="size-4" />새로고침</Button>
      </header>
      {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {done && <p role="status" className="rounded-md border px-3 py-2 text-sm">{done}</p>}
      {loading && !items ? <LoadingBlock /> : !items?.length ? (
        <p className="text-sm text-muted-foreground">승인 대기 중인 사례가 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((item) => (
            <li key={item.case.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <strong>{item.case.title}</strong>
                  <Badge variant="secondary">{item.case.expertName ?? item.expertDomainId ?? "세무사"}</Badge>
                  <span className="text-xs text-muted-foreground">요청 {formatDateTime(item.requestedAt)}</span>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void review(item, true)} disabled={busyId === item.case.id}><Check className="size-4" />승인</Button>
                  <Button size="sm" variant="outline" onClick={() => void review(item, false)} disabled={busyId === item.case.id}><X className="size-4" />거부</Button>
                </div>
              </div>
              <pre className="mt-3 whitespace-pre-wrap break-words rounded-md bg-muted px-3 py-2 text-sm">{item.content}</pre>
              {item.case.keywords && <p className="mt-2 text-xs text-muted-foreground">검색어: {item.case.keywords}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
