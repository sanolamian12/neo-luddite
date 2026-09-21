"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, Handshake, RefreshCw, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingBlock, Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ConversationReadOnly, errorMessage } from "@/components/consultation/consultation-parts";
import { OfferStatusBadge } from "@/components/offer/offer-parts";
import { OpenRoomButton } from "@/components/room/open-room-button";
import { useAccountStore } from "@/lib/account-store";
import type { Conversation } from "@/lib/conversation-schema";
import { getOccupation } from "@/lib/occupations";
import { effectiveOfferStatus, useOfferHydrated, useOfferStore } from "@/lib/offer-store";
import {
  OFFER_EXPIRY_DAYS,
  OFFER_MESSAGE_MAX,
  OFFER_PENDING_LIMIT,
  type OfferStatus,
  type PoolCaseSummary,
} from "@/lib/poc-schema";
import { formatDateTime, formatRemaining } from "@/lib/poc-format";
import { cn } from "@/lib/utils";
import * as casePool from "@/services/case-pool";
import * as offerService from "@/services/offer";
import { EXPERT_POOL_NOTICE, MaskReportChips, PoolNotice, daysAgo } from "./pool-parts";

/**
 * 세무사 "상담사 풀" (/audit/pool) — 사장님이 동의한 비식별 사례 목록·상세.
 * 목록은 list_pool_cases()(본문 없음), 상세는 open_pool_case()(마스킹 사본 + 열람 기록).
 * 원문 테이블은 어디서도 읽지 않는다. 상세의 [연결 요청]이 경로 B 의 시작이다(0039 make_offer).
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
            <LoadingBlock className="justify-start px-4 py-6" />
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
  const offerStatus = useMyOfferStatus(item.conversationId) ?? item.myOfferStatus;
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
        {offerStatus && <OfferStatusBadge status={offerStatus} className="text-[10px]" />}
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
    return <LoadingBlock />;
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
      <OfferPanel conversationId={summary.conversationId} />
    </div>
  );
}

/** 이 사례에 대한 내 연결 요청 상태(스토어 — Realtime 으로 승인·거절이 바로 반영된다). */
function useMyOfferStatus(conversationId: string): OfferStatus | undefined {
  const me = useAccountStore((s) => s.auditor.id);
  const offer = useOfferStore((s) =>
    s.offers.find((o) => o.conversationId === conversationId && o.expertId === me),
  );
  return offer ? effectiveOfferStatus(offer) : undefined;
}

/**
 * [연결 요청] — 경로 B 의 시작. 메시지 1건(선택)을 동봉해 사장님에게 보낸다(make_offer).
 * 사례당 1회라 이미 보냈으면 상태만 보여 준다: 대기(철회 가능) · 승인(채팅방) · 거절·철회·만료.
 */
function OfferPanel({ conversationId }: { conversationId: string }) {
  const hydrated = useOfferHydrated();
  const me = useAccountStore((s) => s.auditor.id);
  const offer = useOfferStore((s) =>
    s.offers.find((o) => o.conversationId === conversationId && o.expertId === me),
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setConfirmWithdraw(false);
    } catch (e) {
      setError(offerService.offerErrorMessage(e, fallback));
    } finally {
      setBusy(false);
    }
  };

  const status = offer ? effectiveOfferStatus(offer) : undefined;
  const declineNote = offer?.statusHistory.findLast((h) => h.status === "declined")?.note;

  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-brand-blue/40 bg-brand-blue/5 p-4"
      data-testid="offer-panel"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Handshake className="size-4 text-brand-blue" />
        <h3 className="text-sm font-semibold">연결 요청</h3>
        {status && <OfferStatusBadge status={status} />}
      </div>

      {!hydrated ? (
        <Spinner size="sm" label="요청 상태 확인 중…" />
      ) : !offer ? (
        <>
          <p className="text-xs break-keep text-muted-foreground">
            이 사례의 사장님에게 내 상담 프로필과 메시지를 보냅니다. 사장님이 승인하면 채팅방이 열립니다.
            사례당 한 번만 요청할 수 있고, 한 사례에 대기 중인 요청은 {OFFER_PENDING_LIMIT}건까지이며,{" "}
            {OFFER_EXPIRY_DAYS}일 안에 응답이 없으면 만료됩니다.
          </p>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, OFFER_MESSAGE_MAX))}
            placeholder="사장님께 남길 메시지(선택) — 예: 치과 종합소득세 신고 경험이 많습니다."
            rows={3}
            className="bg-background text-sm"
            aria-label="연결 요청 메시지"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(() => offerService.makeOffer(conversationId, message), "요청을 보내지 못했습니다.")
              }
            >
              {busy ? <Spinner size="sm" className="text-inherit" /> : <Handshake />}
              연결 요청 보내기
            </Button>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {message.length}/{OFFER_MESSAGE_MAX}
            </span>
          </div>
        </>
      ) : (
        <>
          {offer.message && (
            <p className="rounded-lg bg-background px-3 py-2 text-sm whitespace-pre-wrap break-keep">
              {offer.message}
            </p>
          )}
          <p className="text-xs break-keep text-muted-foreground">
            {status === "pending" &&
              `${formatDateTime(offer.createdAt)}에 요청했습니다. 사장님의 응답을 기다리는 중입니다(남은 기간 ${formatRemaining(offer.expiresAt)}).`}
            {status === "approved" && "사장님이 승인했습니다. 채팅방에서 대화를 시작하세요."}
            {status === "declined" &&
              `사장님이 이번 요청을 받지 않았습니다${declineNote ? ` — “${declineNote}”` : ""}. 이 사례에는 다시 요청할 수 없습니다(사례당 1회).`}
            {status === "withdrawn" && "요청을 철회했습니다. 이 사례에는 다시 요청할 수 없습니다(사례당 1회)."}
            {status === "expired" &&
              `${OFFER_EXPIRY_DAYS}일 동안 응답이 없어 만료되었습니다. 이 사례에는 다시 요청할 수 없습니다(사례당 1회).`}
          </p>
          {status === "approved" && (
            <OpenRoomButton conversationId={conversationId} expertId={me} side="expert" />
          )}
          {status === "pending" &&
            (confirmWithdraw ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm">요청을 철회할까요? 사장님에게 철회 알림이 가고, 다시 요청할 수 없습니다.</span>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void run(() => offerService.withdraw(offer.id), "철회하지 못했습니다.")}
                >
                  철회하기
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmWithdraw(false)}>
                  돌아가기
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" className="w-fit" onClick={() => setConfirmWithdraw(true)}>
                요청 철회
              </Button>
            ))}
        </>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </section>
  );
}

function PoolTranscript({ payload }: { payload: Conversation | null | undefined }) {
  if (!payload?.messages?.length) {
    return <p className="text-sm text-muted-foreground">대화 내용이 없습니다.</p>;
  }
  return <ConversationReadOnly conversation={payload} />;
}
