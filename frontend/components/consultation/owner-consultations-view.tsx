"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Heart, MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExpertCardView } from "@/components/expert/expert-card";
import { useAccountStore } from "@/lib/account-store";
import { useAuditorRegistryStore } from "@/lib/auditor-registry-store";
import { useConsultationHydrated, useConsultationStore } from "@/lib/consultation-store";
import { useConversationRecord } from "@/lib/conversation-store";
import { useMailStore } from "@/lib/mail-store";
import type { ConsultationRequest, ExpertCard } from "@/lib/poc-schema";
import { cn } from "@/lib/utils";
import * as consultationService from "@/services/consultation";
import * as expertService from "@/services/expert";
import * as mailService from "@/services/mail";
import { OwnerPoolConsent } from "@/components/case-pool/owner-pool-consent";
import {
  ConsultationListItem,
  ConsultationMessage,
  ConsultationStatusBadge,
  ConsultationTimeline,
  errorMessage,
  sortConsultations,
} from "./consultation-parts";

/**
 * 사장님 "세무사 상담" — 내 상담 신청 추적 (/consultations).
 * 대기 중 취소 · 수락 후 담당 세무사 연락처 · 완료 후 하트.
 * 알림 메일(kind=consultation)은 사장님 우편함이 없으므로 여기서 읽음 처리한다.
 */
export function OwnerConsultationsView({ initialId }: { initialId?: string }) {
  const hydrated = useConsultationHydrated();
  const viewerId = useAccountStore((s) => s.viewer.id);
  const requests = useConsultationStore((s) => s.requests);
  const auditors = useAuditorRegistryStore((s) => s.auditors);

  const mine = useMemo(
    () => sortConsultations(requests.filter((r) => r.viewerId === viewerId)),
    [requests, viewerId],
  );

  const [selectedId, setSelectedId] = useState<string | null>(initialId ?? null);
  const [mobileView, setMobileView] = useState<"list" | "detail">(
    initialId ? "detail" : "list",
  );

  // 아무것도 고르지 않았으면 목록 맨 위를 보여 준다.
  const activeId = selectedId ?? mine[0]?.id ?? null;
  const selected = mine.find((r) => r.id === activeId) ?? null;
  const expertName = (id: string) => auditors.find((a) => a.id === id)?.displayName ?? id;

  if (!hydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">불러오는 중…</div>;
  }

  if (mine.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <MessagesSquare className="size-8 text-muted-foreground" />
        <h1 className="text-lg font-semibold">아직 신청한 세무사 상담이 없습니다</h1>
        <p className="text-sm break-keep text-muted-foreground">
          AI 상담 중 “세무사와 상담하고 싶어요”라고 말하거나, 답변 아래 세무사 연결 카드에서 신청할 수
          있습니다.
        </p>
        <Button variant="outline" render={<Link href="/select" />}>
          AI 상담으로 가기
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        className={cn(
          "w-full shrink-0 flex-col border-r md:flex md:w-[320px]",
          mobileView === "detail" ? "hidden md:flex" : "flex",
        )}
      >
        <div className="border-b px-4 py-3">
          <h1 className="text-sm font-semibold">세무사 상담 신청</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">{mine.length}건</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {mine.map((r) => (
            <ConsultationListItem
              key={r.id}
              request={r}
              title={`${expertName(r.expertId)} 세무사`}
              subtitle={r.message}
              selected={r.id === activeId}
              onSelect={() => {
                setSelectedId(r.id);
                setMobileView("detail");
              }}
            />
          ))}
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
          ← 신청 목록
        </button>
        {selected ? (
          <OwnerDetail
            key={selected.id}
            request={selected}
            expertName={expertName(selected.expertId)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            왼쪽에서 신청을 선택하세요.
          </div>
        )}
      </div>
    </div>
  );
}

function OwnerDetail({
  request,
  expertName,
}: {
  request: ConsultationRequest;
  expertName: string;
}) {
  const viewerId = useAccountStore((s) => s.viewer.id);
  const conversation = useConversationRecord(request.conversationId);
  const mails = useMailStore((s) => s.mails);

  // 이 신청에 딸린 안 읽은 알림 메일 → 읽음 (사이드바 뱃지가 줄어든다).
  useEffect(() => {
    for (const m of mails) {
      if (
        m.recipientId === viewerId &&
        !m.readAt &&
        m.ref?.kind === "consultation" &&
        m.ref.requestId === request.id
      ) {
        void mailService.markRead(m.id);
      }
    }
  }, [mails, viewerId, request.id]);

  // 담당 세무사 카드 — list_experts() 가 수락 여부에 따라 연락처를 열어 준다.
  // 상태가 바뀌면(Realtime) 다시 조회해야 연락처가 열린다.
  const [expert, setExpert] = useState<ExpertCard | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    expertService
      .listExperts(request.conversationId)
      .then((items) => {
        if (alive) setExpert(items.find((e) => e.auditorId === request.expertId) ?? null);
      })
      .catch(() => {
        if (alive) setExpert(null);
      });
    return () => {
      alive = false;
    };
  }, [request.conversationId, request.expertId, request.status]);

  const [likeBusy, setLikeBusy] = useState(false);
  const onToggleLike = async () => {
    if (!expert) return;
    setLikeBusy(true);
    try {
      const r = await expertService.toggleLike(expert.auditorId, request.conversationId);
      setExpert({ ...expert, likedByMe: r.liked, likeCount: r.likeCount });
    } finally {
      setLikeBusy(false);
    }
  };

  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onCancel = async () => {
    setBusy(true);
    setError(null);
    try {
      await consultationService.transition(request.id, "cancelled");
      setConfirmCancel(false);
    } catch (e) {
      setError(errorMessage(e, "취소하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };

  const actorName = (id: string | undefined) =>
    id === request.viewerId ? "나" : id === request.expertId ? `${expertName} 세무사` : "운영자";

  const showContacts = request.status === "accepted" || request.status === "completed";

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 md:px-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-bold tracking-tight">{expertName} 세무사</h2>
          <ConsultationStatusBadge status={request.status} />
        </div>
        <p className="text-sm break-keep text-muted-foreground">{STATUS_GUIDE[request.status]}</p>
      </header>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">
          {showContacts ? "담당 세무사 · 연락처" : "신청한 세무사"}
        </h3>
        {expert === undefined ? (
          <div className="h-28 animate-pulse rounded-xl bg-muted/50" />
        ) : expert ? (
          <ExpertCardView expert={expert} />
        ) : (
          <p className="rounded-xl border px-4 py-3 text-sm text-muted-foreground">
            이 세무사의 상담 프로필이 지금은 공개되어 있지 않습니다.
          </p>
        )}
        {showContacts && expert && !hasAnyContact(expert) && (
          <p className="text-xs text-muted-foreground">
            세무사가 공개한 연락처가 없습니다. 세무사가 먼저 연락드릴 예정입니다.
          </p>
        )}
        {request.status === "completed" && expert && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50/60 px-4 py-3 dark:border-rose-900/50 dark:bg-rose-950/20">
            <Heart
              className={cn("size-5 text-rose-500", expert.likedByMe && "fill-rose-500")}
            />
            <p className="min-w-[10rem] flex-1 text-sm break-keep">
              {expert.likedByMe
                ? "하트를 남겼습니다. 감사합니다!"
                : "상담이 도움이 됐나요? 하트로 세무사에게 고마움을 전해 주세요."}
            </p>
            <Button
              size="sm"
              variant={expert.likedByMe ? "outline" : "default"}
              disabled={likeBusy}
              onClick={() => void onToggleLike()}
            >
              {expert.likedByMe ? "하트 취소" : "♥ 하트 남기기"}
            </Button>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">신청한 AI 상담</h3>
        <div className="flex flex-wrap items-center gap-2 rounded-xl border px-4 py-3">
          <MessagesSquare className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm">
            {conversation?.title ?? "AI 상담"}
          </span>
          {conversation && (
            <Button
              size="sm"
              variant="outline"
              render={
                <Link
                  href={`/chat/${conversation.occupation}?c=${encodeURIComponent(conversation.id)}`}
                />
              }
            >
              대화 열기
            </Button>
          )}
        </div>
      </section>

      <OwnerPoolConsent conversationId={request.conversationId} />

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">남긴 메시지</h3>
        <ConsultationMessage message={request.message} />
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">진행 기록</h3>
        <ConsultationTimeline request={request} actorName={actorName} />
      </section>

      {request.status === "pending" && (
        <section className="flex flex-col gap-2 border-t pt-4">
          {confirmCancel ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">신청을 취소할까요? 세무사에게 취소 알림이 갑니다.</span>
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => void onCancel()}>
                취소하기
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmCancel(false)}>
                돌아가기
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              onClick={() => setConfirmCancel(true)}
            >
              신청 취소
            </Button>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </section>
      )}
    </div>
  );
}

const STATUS_GUIDE: Record<ConsultationRequest["status"], string> = {
  pending: "세무사가 신청을 확인하고 있습니다. 수락되면 이 화면에서 연락처가 열립니다.",
  accepted: "세무사가 상담을 수락했습니다. 아래 연락처로 연락해 보세요.",
  completed: "상담이 완료되었습니다.",
  declined: "세무사가 이번 신청을 받지 못했습니다. AI 상담의 연결 카드에서 다른 세무사에게 신청할 수 있습니다.",
  cancelled: "이 신청은 취소되었습니다.",
};

function hasAnyContact(e: ExpertCard): boolean {
  return Object.values(e.contacts).some((c) => Boolean(c.value));
}
