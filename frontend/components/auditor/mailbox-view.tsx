"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMailHydrated, useMailStore } from "@/lib/mail-store";
import { useAccountStore } from "@/lib/account-store";
import { useOfferStore } from "@/lib/offer-store";
import { useRoomStore } from "@/lib/room-store";
import { formatDateTime } from "@/lib/poc-format";
import { cn, middleTruncate } from "@/lib/utils";
import * as mailService from "@/services/mail";
import type { Mail, MailKind } from "@/lib/poc-schema";
import { LoadingBlock } from "@/components/ui/spinner";

const KIND_LABEL: Record<MailKind, string> = {
  notice: "공지",
  inquiry_reply: "이의 답변",
  settlement: "정산 안내",
  consultation: "상담 신청",
};

const KIND_VARIANT: Record<MailKind, "default" | "secondary" | "outline"> = {
  notice: "secondary",
  inquiry_reply: "default",
  settlement: "outline",
  consultation: "default",
};

export function MailboxView() {
  const hydrated = useMailHydrated();
  const mails = useMailStore((s) => s.mails);
  const auditorId = useAccountStore((s) => s.auditor.id);

  const [filter, setFilter] = useState<MailKind | "all" | "unread">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 모바일(<md)에서는 목록/상세를 동시에 못 띄우므로 전환한다.
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");

  const myMails = useMemo(
    () =>
      mails
        .filter((m) => m.recipientId === auditorId)
        .sort((a, b) => b.sentAt - a.sentAt),
    [mails, auditorId],
  );

  const filtered = useMemo(() => {
    if (filter === "all") return myMails;
    if (filter === "unread") return myMails.filter((m) => !m.readAt);
    return myMails.filter((m) => m.kind === filter);
  }, [myMails, filter]);

  useEffect(() => {
    if (!selectedId && filtered.length > 0) setSelectedId(filtered[0].id);
  }, [filtered, selectedId]);

  // 진입 시 자동 markRead
  useEffect(() => {
    if (!selectedId) return;
    const m = myMails.find((x) => x.id === selectedId);
    if (m && !m.readAt) void mailService.markRead(selectedId);
  }, [selectedId, myMails]);

  if (!hydrated) {
    return <LoadingBlock label="로딩 중…" />;
  }

  const selected = filtered.find((m) => m.id === selectedId) ?? null;

  return (
    <div className="flex flex-1 min-h-0">
      <aside
        className={cn(
          "w-full shrink-0 flex-col border-r md:flex md:w-[320px]",
          mobileView === "detail" ? "hidden md:flex" : "flex",
        )}
      >
        <div className="border-b px-3 py-2">
          <h1 className="text-sm font-semibold">우편함</h1><p className="mt-2 text-xs leading-relaxed text-muted-foreground">운영 공지와 시스템 알림을 받습니다. 고객 대화는 채팅방에서 확인하세요. 동료 전문가 메시지는 아직 연결되지 않았습니다.</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {(["all", "unread", "notice", "consultation"] as const).map((s) => (
              <Button
                key={s}
                size="xs"
                variant={filter === s ? "default" : "outline"}
                onClick={() => setFilter(s)}
              >
                {s === "all" ? "전체" : s === "unread" ? "미확인" : KIND_LABEL[s as MailKind]}
              </Button>
            ))}
          </div>
        </div>
        <ul className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-sm text-muted-foreground">없습니다.</li>
          ) : (
            filtered.map((m) => (
              <li key={m.id}>
                <button
                  onClick={() => {
                    setSelectedId(m.id);
                    setMobileView("detail");
                  }}
                  className={cn(
                    "w-full px-3 py-2 text-left text-sm transition border-b",
                    selectedId === m.id ? "bg-muted" : "hover:bg-muted/50",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={KIND_VARIANT[m.kind]} className="text-[10px]">
                      {KIND_LABEL[m.kind]}
                    </Badge>
                    {!m.readAt && (
                      <span className="size-1.5 rounded-full bg-primary" aria-label="미확인" />
                    )}
                  </div>
                  <p className={cn("mt-1 truncate font-medium", !m.readAt && "font-semibold")}>
                    {m.subject}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {formatDateTime(m.sentAt)}
                  </p>
                </button>
              </li>
            ))
          )}
        </ul>
      </aside>

      <main
        className={cn(
          "flex-1 overflow-y-auto md:block",
          mobileView === "list" ? "hidden" : "block",
        )}
      >
        {/* 모바일 전용 뒤로가기 */}
        <button
          type="button"
          onClick={() => setMobileView("list")}
          className="flex w-full items-center gap-1 border-b px-4 py-2 text-sm text-muted-foreground md:hidden"
        >
          ← 우편함 목록
        </button>
        {!selected ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            왼쪽에서 우편을 선택하세요.
          </div>
        ) : (
          <MailDetail mail={selected} />
        )}
      </main>
    </div>
  );
}

/**
 * 우편 상세. 옛 이의 답변·정산 안내 우편(10/16 끊긴 검수 흐름)은 본문만 보인다 — 연결된 이의제기·정산 회차 화면은 없앴다.
 */
function MailDetail({ mail }: { mail: Mail }) {
  const ref = mail.ref;

  return (
    <div className="ds-page flex flex-col gap-8">
      <header>
        <Badge variant="secondary">{KIND_LABEL[mail.kind]}</Badge>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">{mail.subject}</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          발신 <span title={mail.senderId}>{middleTruncate(mail.senderId)}</span> ·{" "}
          {formatDateTime(mail.sentAt)}
        </p>
      </header>

      <section className="ds-panel px-4 py-3">
        <p className="whitespace-pre-wrap text-sm">{mail.body || "(내용 없음)"}</p>
      </section>

      {ref?.kind === "consultation" && (
        <p className="text-sm">
          <Link
            href={`/audit/consultations/${encodeURIComponent(ref.requestId)}`}
            className="underline"
          >
            상담 신청 보기 →
          </Link>
        </p>
      )}

      {ref?.kind === "room" && (
        <p className="text-sm">
          <Link href={`/audit/rooms/${encodeURIComponent(ref.id)}`} className="underline">
            채팅방 열기 →
          </Link>
        </p>
      )}

      {ref?.kind === "offer" && <OfferMailLink offerId={ref.id} />}
    </div>
  );
}

/**
 * 연결 요청(0039) 알림의 바로가기 — 승인돼 방이 있으면 그 채팅방, 아니면 풀의 그 사례(요청 상태가 보인다).
 * 사례가 풀에서 내려갔으면 풀 상세가 "열 수 없음"을 알려 준다.
 */
function OfferMailLink({ offerId }: { offerId: string }) {
  const offer = useOfferStore((s) => s.offers.find((o) => o.id === offerId));
  const room = useRoomStore((s) =>
    offer
      ? s.rooms.find((r) => r.conversationId === offer.conversationId && r.expertId === offer.expertId)
      : undefined,
  );
  if (!offer) return null;
  return (
    <p className="text-sm">
      {offer.status === "approved" && room ? (
        <Link href={`/audit/rooms/${encodeURIComponent(room.id)}`} className="underline">
          채팅방 열기 →
        </Link>
      ) : (
        <Link href={`/audit/pool/${encodeURIComponent(offer.conversationId)}`} className="underline">
          풀 사례 보기 →
        </Link>
      )}
    </p>
  );
}
