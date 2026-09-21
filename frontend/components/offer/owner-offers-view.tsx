"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Handshake, MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadingBlock, Spinner } from "@/components/ui/spinner";
import { ExpertCardView } from "@/components/expert/expert-card";
import { OpenRoomButton } from "@/components/room/open-room-button";
import { useAccountStore } from "@/lib/account-store";
import { useAuditorRegistryStore } from "@/lib/auditor-registry-store";
import { useConversationRecord } from "@/lib/conversation-store";
import { useMailStore } from "@/lib/mail-store";
import { effectiveOfferStatus, useOfferHydrated, useOfferStore } from "@/lib/offer-store";
import { OFFER_EXPIRY_DAYS, type ConsultationOffer, type ExpertCard } from "@/lib/poc-schema";
import { formatDateTime, formatRemaining } from "@/lib/poc-format";
import { useRoomStore } from "@/lib/room-store";
import { cn } from "@/lib/utils";
import * as expertService from "@/services/expert";
import * as mailService from "@/services/mail";
import * as offerService from "@/services/offer";
import * as roomService from "@/services/room";
import { DECLINE_REASONS, OfferStatusBadge } from "./offer-parts";

/**
 * 사장님 "세무사 연결 요청" (/offers) — 상담사 풀에서 내 사례를 보고 세무사가 보낸 요청(경로 B, 0039).
 * 설정 메뉴(AccountSwitcher)의 "세무사 연결 요청 N건"으로 들어온다.
 * [승인] → DB 가 채팅방을 열고 → 그 방으로 이동. [거절]은 사유를 골라 세무사에게 알린다.
 * 이 화면에 들어오면 요청 알림 메일(ref offer)은 읽음으로 — 사장님은 우편함이 없다.
 */
export function OwnerOffersView() {
  const hydrated = useOfferHydrated();
  const viewerId = useAccountStore((s) => s.viewer.id);
  const offers = useOfferStore((s) => s.offers);
  const mails = useMailStore((s) => s.mails);

  const mine = useMemo(() => {
    const list = offers.filter((o) => o.viewerId === viewerId);
    // 대기 중(만료 전)을 위로, 그다음 최근 갱신 순.
    return list.sort((a, b) => {
      const pa = effectiveOfferStatus(a) === "pending" ? 0 : 1;
      const pb = effectiveOfferStatus(b) === "pending" ? 0 : 1;
      return pa - pb || b.updatedAt - a.updatedAt;
    });
  }, [offers, viewerId]);

  useEffect(() => {
    for (const m of mails) {
      if (m.recipientId === viewerId && !m.readAt && m.ref?.kind === "offer") {
        void mailService.markRead(m.id);
      }
    }
  }, [mails, viewerId]);

  // 세무사 카드는 공개 목록에서 한 번에 받아 둔다(요청마다 부르지 않게).
  const [experts, setExperts] = useState<Map<string, ExpertCard> | null>(null);
  useEffect(() => {
    let alive = true;
    expertService
      .listExperts(null)
      .then((items) => {
        if (alive) setExperts(new Map(items.map((e) => [e.auditorId, e])));
      })
      .catch(() => {
        if (alive) setExperts(new Map());
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!hydrated) return <LoadingBlock />;

  const pendingCount = mine.filter((o) => effectiveOfferStatus(o) === "pending").length;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6 md:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold tracking-tight">세무사 연결 요청</h1>
        <p className="text-sm break-keep text-muted-foreground">
          상담사 풀에 공개한 사례를 보고 세무사가 먼저 연결을 요청했습니다. 승인하면 그 세무사와의 채팅방이
          열립니다. {OFFER_EXPIRY_DAYS}일 안에 답하지 않은 요청은 만료됩니다.
        </p>
        <p className="text-xs text-muted-foreground">
          응답 대기 {pendingCount}건 · 전체 {mine.length}건
        </p>
      </header>

      {mine.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <Handshake className="size-8 text-muted-foreground" />
          <p className="text-sm break-keep text-muted-foreground">
            아직 받은 연결 요청이 없습니다. 세무사 상담을 신청할 때 상담사 풀 공개에 동의하면, 다른 세무사도
            사례를 보고 연결을 요청할 수 있습니다.
          </p>
          <Button variant="outline" render={<Link href="/consultations" />}>
            세무사 상담으로
          </Button>
        </div>
      ) : (
        mine.map((o) => (
          <OfferCard key={o.id} offer={o} expert={experts?.get(o.expertId)} expertsLoaded={experts !== null} />
        ))
      )}
    </div>
    </div>
  );
}

function OfferCard({
  offer,
  expert,
  expertsLoaded,
}: {
  offer: ConsultationOffer;
  expert: ExpertCard | undefined;
  expertsLoaded: boolean;
}) {
  const router = useRouter();
  const conversation = useConversationRecord(offer.conversationId);
  // 공개 카드 이름 → 명부 이름 → (둘 다 적재가 끝났는데 없을 때만) id. 적재 중엔 id 를 비추지 않는다.
  const registryName = useAuditorRegistryStore(
    (s) => s.auditors.find((a) => a.id === offer.expertId)?.displayName,
  );
  const expertName = expert?.displayName ?? registryName ?? (expertsLoaded ? offer.expertId : "");
  const status = effectiveOfferStatus(offer);

  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState<string>(DECLINE_REASONS[0]);
  const [error, setError] = useState<string | null>(null);

  const onApprove = async () => {
    setBusy("approve");
    setError(null);
    try {
      await offerService.approve(offer.id);
      // 방은 승인 트랜잭션 안에서 열렸다 — Realtime 을 기다리지 않고 직접 당겨 그 방으로 간다.
      await roomService.fetchRoomFor(offer.conversationId, offer.expertId);
      const room = useRoomStore
        .getState()
        .rooms.find((r) => r.conversationId === offer.conversationId && r.expertId === offer.expertId);
      if (room) router.push(`/rooms/${encodeURIComponent(room.id)}`);
    } catch (e) {
      setError(offerService.offerErrorMessage(e, "승인하지 못했습니다."));
    } finally {
      setBusy(null);
    }
  };

  const onDecline = async () => {
    setBusy("decline");
    setError(null);
    try {
      await offerService.decline(offer.id, reason);
      setDeclining(false);
    } catch (e) {
      setError(offerService.offerErrorMessage(e, "거절하지 못했습니다."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <article
      className={cn(
        "flex flex-col gap-3 rounded-2xl border p-4",
        status === "pending" ? "border-brand-blue/40 bg-brand-blue/5" : "bg-card",
      )}
      data-testid="offer-card"
      data-status={status}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {expertName ? `${expertName} 세무사의 연결 요청` : "세무사의 연결 요청"}
        </h2>
        <OfferStatusBadge status={status} />
      </div>

      {expert ? (
        <ExpertCardView expert={expert} />
      ) : expertsLoaded ? (
        <p className="rounded-xl border bg-background px-4 py-3 text-sm text-muted-foreground">
          이 세무사의 상담 프로필이 지금은 공개되어 있지 않습니다.
        </p>
      ) : (
        <div className="h-28 animate-pulse rounded-xl bg-muted/50" />
      )}

      {offer.message && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">세무사 메시지</p>
          <p className="rounded-lg bg-background px-3 py-2 text-sm whitespace-pre-wrap break-keep" data-testid="offer-message">
            {offer.message}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-background px-3 py-2">
        <MessagesSquare className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm" data-testid="offer-conversation">
          {conversation?.title ?? "AI 상담"}
        </span>
        {conversation && (
          <Button
            size="xs"
            variant="outline"
            render={<Link href={`/chat/${conversation.occupation}?c=${encodeURIComponent(conversation.id)}`} />}
          >
            대화 보기
          </Button>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground tabular-nums">
        요청 {formatDateTime(offer.createdAt)}
        {status === "pending" && ` · 남은 기간 ${formatRemaining(offer.expiresAt)}`}
        {status !== "pending" && offer.updatedAt !== offer.createdAt && ` · 처리 ${formatDateTime(offer.updatedAt)}`}
      </p>

      {status === "pending" &&
        (declining ? (
          <fieldset className="flex flex-col gap-2 border-t pt-3">
            <legend className="mb-1 text-sm font-medium">거절 사유(세무사에게 전달됩니다)</legend>
            {DECLINE_REASONS.map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm break-keep">
                <input
                  type="radio"
                  name={`decline-${offer.id}`}
                  value={r}
                  checked={reason === r}
                  onChange={() => setReason(r)}
                  className="size-4 shrink-0 accent-primary"
                />
                {r}
              </label>
            ))}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => void onDecline()}>
                {busy === "decline" && <Spinner size="sm" className="text-inherit" />}
                거절하기
              </Button>
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setDeclining(false)}>
                돌아가기
              </Button>
            </div>
          </fieldset>
        ) : (
          <div className="flex flex-wrap gap-2 border-t pt-3">
            <Button size="sm" disabled={busy !== null} onClick={() => void onApprove()} data-testid="offer-approve">
              {busy === "approve" ? <Spinner size="sm" className="text-inherit" /> : <Handshake />}
              승인하고 채팅방 열기
            </Button>
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => setDeclining(true)}>
              거절
            </Button>
          </div>
        ))}

      {status === "approved" && (
        <OpenRoomButton conversationId={offer.conversationId} expertId={offer.expertId} side="owner" />
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </article>
  );
}
