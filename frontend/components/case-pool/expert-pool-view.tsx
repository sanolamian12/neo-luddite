"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, RefreshCw, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConversationReadOnly, errorMessage } from "@/components/consultation/consultation-parts";
import type { Conversation } from "@/lib/conversation-schema";
import { getOccupation } from "@/lib/occupations";
import type { PoolCaseSummary } from "@/lib/poc-schema";
import { formatDateTime, formatRemaining } from "@/lib/poc-format";
import { cn } from "@/lib/utils";
import * as casePool from "@/services/case-pool";
import { EXPERT_POOL_NOTICE, MaskReportChips, PoolNotice, daysAgo } from "./pool-parts";

/**
 * 세무사 "상담사 풀" (/audit/pool) — 사장님이 동의한 비식별 사례 목록·상세. 읽기 전용.
 * 목록은 list_pool_cases()(본문 없음), 상세는 open_pool_case()(마스킹 사본 + 열람 기록).
 * 원문 테이블은 어디서도 읽지 않는다. [연결 요청]은 다음 단계(c).
 */
export function ExpertPoolView({ initialId }: { initialId?: string }) {
  const [cases, setCases] = useState<PoolCaseSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(initialId ?? null);
  const [mobileView, setMobileView] = useState<"list" | "detail">(initialId ? "detail" : "list");

  useEffect(() => {
    let alive = true;
    casePool
      .listCases()
      .then((items) => {
        if (!alive) return;
        setCases(items);
        setLoadError(null);
      })
      .catch((e: unknown) => {
        if (alive) setLoadError(errorMessage(e, "풀을 불러오지 못했습니다."));
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  // 상세를 열면 열람 표시가 바뀐다 — 목록을 다시 받지 않고 그 칸만 고친다.
  const markViewed = useCallback((id: string) => {
    setCases((list) => list?.map((c) => (c.conversationId === id ? { ...c, viewedByMe: true } : c)) ?? list);
  }, []);

  const activeId = selectedId ?? cases?.[0]?.conversationId ?? null;

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        className={cn(
          "w-full shrink-0 flex-col border-r md:flex md:w-[360px]",
          mobileView === "detail" ? "hidden md:flex" : "flex",
        )}
      >
        <div className="flex flex-col gap-2 border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <h1 className="min-w-0 flex-1 text-sm font-semibold">상담사 풀</h1>
            <Button size="xs" variant="outline" onClick={reload} aria-label="새로고침">
              <RefreshCw className="size-3" /> 새로고침
            </Button>
          </div>
          <PoolNotice>{EXPERT_POOL_NOTICE}</PoolNotice>
          {cases && <p className="text-xs text-muted-foreground">공개 중인 사례 {cases.length}건</p>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loadError ? (
            <p className="px-4 py-6 text-sm text-destructive">{loadError}</p>
          ) : cases === null ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">불러오는 중…</p>
          ) : cases.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <Users className="size-7 text-muted-foreground" />
              <p className="text-sm break-keep text-muted-foreground">
                지금 공개된 사례가 없습니다. 사장님이 세무사 상담을 신청하면서 풀 공개에 동의하면
                여기에 7일 동안 올라옵니다.
              </p>
            </div>
          ) : (
            cases.map((c) => (
              <PoolCaseListItem
                key={c.conversationId}
                item={c}
                selected={c.conversationId === activeId}
                onSelect={() => {
                  setSelectedId(c.conversationId);
                  setMobileView("detail");
                }}
              />
            ))
          )}
        </div>
      </aside>

      <div
        className={cn(
          "min-w-0 flex-1 overflow-y-auto",
          mobileView === "list" ? "hidden md:block" : "block",
        )}
      >
        <button
          type="button"
          onClick={() => setMobileView("list")}
          className="flex w-full items-center gap-1 border-b px-4 py-2 text-sm text-muted-foreground md:hidden"
        >
          ← 사례 목록
        </button>
        {activeId ? (
          <PoolCaseDetail key={activeId} conversationId={activeId} onOpened={markViewed} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {cases?.length ? "왼쪽에서 사례를 선택하세요." : ""}
          </div>
        )}
      </div>
    </div>
  );
}

function PoolCaseListItem({
  item,
  selected,
  onSelect,
}: {
  item: PoolCaseSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const occ = item.occupation ? getOccupation(item.occupation) : undefined;
  const tags = [occ?.label, item.taxCategory].filter(
    (t, i, a): t is string => Boolean(t) && a.indexOf(t) === i,
  );
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full flex-col gap-1.5 border-b px-4 py-3 text-left transition-colors",
        selected ? "bg-primary/5" : "hover:bg-muted/50",
      )}
    >
      <div className="flex w-full items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title ?? "AI 상담 사례"}</span>
        {item.viewedByMe && (
          <Badge variant="outline" className="border-transparent bg-muted text-[10px] text-muted-foreground">
            <Eye className="size-3" /> 열람함
          </Badge>
        )}
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((t) => (
            <Badge key={t} variant="outline" className="text-[10px]">
              {t}
            </Badge>
          ))}
        </div>
      )}
      {item.firstQuestion && (
        <span className="line-clamp-2 text-xs break-keep text-muted-foreground">{item.firstQuestion}</span>
      )}
      <span className="text-[11px] text-muted-foreground tabular-nums">
        질문 {item.turnCount}회 · {daysAgo(item.grantedAt)} 등재 · 남은 기간 {formatRemaining(item.expiresAt)}
      </span>
    </button>
  );
}

function PoolCaseDetail({
  conversationId,
  onOpened,
}: {
  conversationId: string;
  onOpened: (id: string) => void;
}) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; data: Awaited<ReturnType<typeof casePool.openCase>> }
  >({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    casePool
      .openCase(conversationId)
      .then((data) => {
        if (!alive) return;
        setState({ kind: "ready", data });
        onOpened(conversationId);
      })
      .catch((e: unknown) => {
        if (alive)
          setState({
            kind: "error",
            message: errorMessage(e, "사례를 열 수 없습니다(철회되었거나 만료되었을 수 있습니다)."),
          });
      });
    return () => {
      alive = false;
    };
  }, [conversationId, onOpened]);

  if (state.kind === "loading") {
    return <div className="px-6 py-10 text-sm text-muted-foreground">불러오는 중…</div>;
  }
  if (state.kind === "error") {
    return <div className="px-6 py-10 text-sm text-muted-foreground">{state.message}</div>;
  }
  const { summary, payload } = state.data;
  const occ = summary.occupation ? getOccupation(summary.occupation) : undefined;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6 md:px-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-bold tracking-tight break-keep">{summary.title ?? "AI 상담 사례"}</h2>
        <p className="text-xs text-muted-foreground">
          {[occ?.label, summary.taxCategory].filter(Boolean).join(" · ")}
          {` · 등재 ${formatDateTime(summary.grantedAt)} · ${formatDateTime(summary.expiresAt)}까지`}
        </p>
      </header>
      <PoolNotice>{EXPERT_POOL_NOTICE}</PoolNotice>
      <section className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">가려진 항목</h3>
        <MaskReportChips report={summary.maskReport} />
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">비식별 대화</h3>
        <div className="rounded-xl border bg-muted/20 p-3">
          <PoolTranscript payload={payload} />
        </div>
      </section>
      <p className="text-xs break-keep text-muted-foreground">
        이 사례의 사장님에게 연결을 요청하는 기능은 준비 중입니다.
      </p>
    </div>
  );
}

function PoolTranscript({ payload }: { payload: Conversation | null | undefined }) {
  if (!payload?.messages?.length) {
    return <p className="text-sm text-muted-foreground">대화 내용이 없습니다.</p>;
  }
  return <ConversationReadOnly conversation={payload} />;
}
