"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAccountStore } from "@/lib/account-store";
import { useConversationRecord } from "@/lib/conversation-store";
import { useMailStore } from "@/lib/mail-store";
import { getOccupation } from "@/lib/occupations";
import type { ConsultationRequest } from "@/lib/poc-schema";
import { formatDateTime } from "@/lib/poc-format";
import * as consultationService from "@/services/consultation";
import * as mailService from "@/services/mail";
import { OpenRoomButton } from "@/components/room/open-room-button";
import {
  ConsultationMessage,
  ConsultationStatusBadge,
  ConsultationTimeline,
  ConversationReadOnly,
  errorMessage,
} from "./consultation-parts";

/**
 * 세무사·관리자 쪽 신청 상세. 세무사(canAct)는 수락 / 거절(사유 선택) / 완료를 누른다.
 * 관리자 화면은 읽기 전용으로 같은 상세를 쓴다.
 */
export function StaffConsultationDetail({
  request,
  ownerName,
  expertName,
  canAct,
  /** 이 사용자 앞 알림 메일을 상세 열람 시 읽음 처리할 수신자 id. */
  readerId,
  onTransitioned,
}: {
  request: ConsultationRequest;
  ownerName: string;
  expertName: string;
  canAct: boolean;
  readerId?: string;
  /** 전이 성공 후 — 목록이 이 신청을 계속 선택해 두게(필터에서 빠져도 상세가 사라지지 않게). */
  onTransitioned?: (id: string) => void;
}) {
  const conversation = useConversationRecord(request.conversationId);
  const mails = useMailStore((s) => s.mails);
  const myDomainId = useAccountStore((s) => s.auditor.id);

  useEffect(() => {
    if (!readerId) return;
    for (const m of mails) {
      if (
        m.recipientId === readerId &&
        !m.readAt &&
        m.ref?.kind === "consultation" &&
        m.ref.requestId === request.id
      ) {
        void mailService.markRead(m.id);
      }
    }
  }, [mails, readerId, request.id]);

  const [mode, setMode] = useState<"idle" | "decline" | "complete">("idle");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (next: "accepted" | "declined" | "completed", withNote?: string) => {
    setBusy(true);
    setError(null);
    try {
      await consultationService.transition(request.id, next, withNote);
      onTransitioned?.(request.id);
      setMode("idle");
      setNote("");
    } catch (e) {
      setError(errorMessage(e, "처리하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };

  const actorName = (id: string | undefined) =>
    id === request.viewerId
      ? ownerName
      : id === request.expertId
        ? id === myDomainId && canAct
          ? "나"
          : `${expertName} 세무사`
        : "운영자";

  const occ = conversation ? getOccupation(conversation.occupation) : undefined;
  const transcript = conversation?.payload;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 md:px-6">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-bold tracking-tight">{ownerName}</h2>
          <ConsultationStatusBadge status={request.status} />
        </div>
        <p className="text-xs text-muted-foreground">
          담당 {expertName} 세무사 · 신청 {formatDateTime(request.createdAt)}
          {occ && ` · ${occ.label}`}
        </p>
      </header>

      {canAct && request.status === "pending" && (
        <section className="flex flex-col gap-3 rounded-xl border border-brand-amber/40 bg-brand-amber/5 p-4">
          <p className="text-sm break-keep">
            아래 AI 상담 원문과 메시지를 보고 상담을 맡을지 정해 주세요. 수락하면 사장님과의 채팅방이
            열리고 사장님에게 알림이 갑니다. “상담 수락 후 공개”로 둔 연락처도 사장님에게 열립니다.
          </p>
          {mode === "decline" ? (
            <div className="flex flex-col gap-2">
              <Textarea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="거절 사유 (선택) — 적으면 사장님에게 함께 전달됩니다"
                aria-label="거절 사유"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void run("declined", note)}
                >
                  거절 확정
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMode("idle")}>
                  돌아가기
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy} onClick={() => void run("accepted")}>
                상담 수락
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setMode("decline")}>
                거절
              </Button>
            </div>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </section>
      )}

      {canAct && request.status === "accepted" && (
        <section className="flex flex-col gap-3 rounded-xl border border-brand-blue/40 bg-brand-blue/5 p-4">
          <p className="text-sm break-keep">
            상담을 진행 중입니다. 사장님과 상담을 마치면 완료로 표시해 주세요. 완료 알림에는 하트 요청이
            함께 갑니다.
          </p>
          <OpenRoomButton
            conversationId={request.conversationId}
            expertId={request.expertId}
            side="expert"
          />
          {mode === "complete" ? (
            <div className="flex flex-col gap-2">
              <Textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="사장님에게 남길 메모 (선택)"
                aria-label="완료 메모"
              />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy} onClick={() => void run("completed", note)}>
                  완료 확정
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMode("idle")}>
                  돌아가기
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" className="w-fit" onClick={() => setMode("complete")}>
              상담 완료
            </Button>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </section>
      )}

      {canAct && request.status === "completed" && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">채팅방</h3>
          <OpenRoomButton
            conversationId={request.conversationId}
            expertId={request.expertId}
            side="expert"
          />
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">사장님이 남긴 메시지</h3>
        <ConsultationMessage message={request.message} />
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">
          AI 상담 원문
          {conversation?.title && (
            <span className="ml-2 font-normal text-muted-foreground">{conversation.title}</span>
          )}
        </h3>
        <div className="max-h-[60vh] overflow-y-auto rounded-xl border bg-muted/20 p-3">
          {transcript ? (
            <ConversationReadOnly conversation={transcript} />
          ) : (
            <p className="text-sm text-muted-foreground">
              대화 원문을 불러오지 못했습니다(대화가 삭제되었을 수 있습니다).
            </p>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">진행 기록</h3>
        <ConsultationTimeline request={request} actorName={actorName} />
      </section>
    </div>
  );
}
