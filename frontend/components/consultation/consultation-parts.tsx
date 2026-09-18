"use client";

import { Badge } from "@/components/ui/badge";
import { UiBlocks } from "@/components/chat/ui-blocks";
import type { Conversation } from "@/lib/conversation-schema";
import type { ConsultationRequest, ConsultationStatus } from "@/lib/poc-schema";
import { formatDateTime } from "@/lib/poc-format";
import { cn } from "@/lib/utils";
import { STATUS_LABEL } from "@/services/consultation";

/**
 * 상담 신청 화면 3개(사장님 / 세무사 / 관리자)가 함께 쓰는 조각.
 * 원본: credigraph prototype components/consultation/* (패턴만 이식).
 */

export const STATUS_ORDER: ConsultationStatus[] = [
  "pending",
  "accepted",
  "completed",
  "declined",
  "cancelled",
];

const STATUS_CLASS: Record<ConsultationStatus, string> = {
  pending: "bg-brand-amber/15 text-brand-amber",
  accepted: "bg-brand-blue/15 text-brand-blue",
  completed: "bg-brand-green/15 text-brand-green",
  declined: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

const STATUS_DOT: Record<ConsultationStatus, string> = {
  pending: "bg-brand-amber",
  accepted: "bg-brand-blue",
  completed: "bg-brand-green",
  declined: "bg-destructive",
  cancelled: "bg-muted-foreground",
};

export function ConsultationStatusBadge({
  status,
  className,
}: {
  status: ConsultationStatus;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn("border-transparent", STATUS_CLASS[status], className)}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

/** 목록 정렬: 대기 → 수락 → 나머지, 같은 상태 안에서는 최근 갱신 순. */
export function sortConsultations(items: ConsultationRequest[]): ConsultationRequest[] {
  const rank = (s: ConsultationStatus) => STATUS_ORDER.indexOf(s);
  return [...items].sort((a, b) => {
    const r = rank(a.status) - rank(b.status);
    return r !== 0 ? r : b.updatedAt - a.updatedAt;
  });
}

/** Supabase 오류(PostgrestError)는 Error 인스턴스가 아닐 수 있다 — message 만 꺼낸다. */
export function errorMessage(e: unknown, fallback: string): string {
  const m = (e as { message?: unknown } | null)?.message;
  return typeof m === "string" && m ? m : fallback;
}

/** 상태 이력. actorName 은 domain id → 화면 이름. */
export function ConsultationTimeline({
  request,
  actorName,
}: {
  request: ConsultationRequest;
  actorName: (actorId: string | undefined) => string;
}) {
  const history = request.statusHistory.length
    ? request.statusHistory
    : [{ status: "pending" as const, at: request.createdAt, actor: request.viewerId }];
  return (
    <ol className="relative flex flex-col gap-3 border-l pl-4">
      {history.map((h, i) => (
        <li key={`${h.status}-${h.at}-${i}`} className="relative">
          <span
            className={cn(
              "absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-background",
              STATUS_DOT[h.status],
            )}
            aria-hidden
          />
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
            <span className="font-medium">
              {h.status === "pending" ? "신청" : STATUS_LABEL[h.status]}
            </span>
            <span className="text-xs text-muted-foreground">
              {actorName(h.actor)} · {formatDateTime(h.at)}
            </span>
          </div>
          {h.note && (
            <p className="mt-1 rounded-md bg-muted px-2 py-1.5 text-sm whitespace-pre-wrap">
              {h.note}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

/** 신청 시 남긴 메시지. */
export function ConsultationMessage({ message }: { message?: string }) {
  if (!message) {
    return <p className="text-sm text-muted-foreground">남긴 메시지 없음</p>;
  }
  return (
    <p className="rounded-lg border bg-card px-3 py-2 text-sm whitespace-pre-wrap">{message}</p>
  );
}

/** 대화 원문 — 읽기 전용(세무사·관리자가 신청이 온 AI 상담을 확인). */
export function ConversationReadOnly({ conversation }: { conversation: Conversation }) {
  if (!conversation.messages.length) {
    return <p className="text-sm text-muted-foreground">대화 내용이 없습니다.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {conversation.messages.map((m) =>
        m.role === "user" ? (
          <div key={m.id} className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground">
              {m.segments.map((s) => (
                <p key={s.id} className="leading-relaxed whitespace-pre-wrap">
                  {s.text}
                </p>
              ))}
            </div>
          </div>
        ) : (
          <div key={m.id} className="flex justify-start">
            <div className="max-w-[92%] rounded-2xl border bg-card px-3 py-2 text-sm text-card-foreground">
              <div className="flex flex-col gap-1">
                {m.segments.map((s) => (
                  <p key={s.id} className="leading-relaxed whitespace-pre-wrap">
                    {s.text}
                  </p>
                ))}
              </div>
              <UiBlocks blocks={m.uiBlocks} readOnly />
            </div>
          </div>
        ),
      )}
    </div>
  );
}

/** 목록 한 줄(카드). 좌측 목록 패널용. */
export function ConsultationListItem({
  request,
  title,
  subtitle,
  selected,
  onSelect,
}: {
  request: ConsultationRequest;
  title: string;
  subtitle?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full flex-col gap-1 border-b px-4 py-3 text-left transition-colors",
        selected ? "bg-primary/5" : "hover:bg-muted/50",
      )}
    >
      <div className="flex w-full items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
        <ConsultationStatusBadge status={request.status} className="text-[10px]" />
      </div>
      {subtitle && (
        <span className="line-clamp-1 text-xs text-muted-foreground">{subtitle}</span>
      )}
      <span className="text-[11px] text-muted-foreground tabular-nums">
        신청 {formatDateTime(request.createdAt)}
        {request.updatedAt !== request.createdAt && ` · 갱신 ${formatDateTime(request.updatedAt)}`}
      </span>
    </button>
  );
}
