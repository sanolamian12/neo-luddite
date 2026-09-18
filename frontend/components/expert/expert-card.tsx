"use client";

import { Award, Heart, Mail, MessageCircle, Phone } from "lucide-react";
import type {
  ConsultationAvailability,
  ContactChannel,
  ExpertCard,
} from "@/lib/poc-schema";
import { CONTACT_CHANNELS } from "@/lib/poc-schema";
import { CONTACT_LABEL } from "@/services/expert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * 세무사 카드 한 장 — 채팅 연결 카드의 팝오버 목록과 /audit/profile 미리보기가 공유한다.
 * (원본: credigraph prototype expert-handoff-block.tsx ExpertCard)
 */

export const AVAILABILITY_LABEL: Record<ConsultationAvailability, string> = {
  available: "상담 가능",
  busy: "상담 중",
  offline: "오프라인",
};

const AVAILABILITY_DOT: Record<ConsultationAvailability, string> = {
  available: "bg-brand-green",
  busy: "bg-brand-amber",
  offline: "bg-muted-foreground",
};

const CONTACT_ICON: Record<ContactChannel, typeof Phone> = {
  phone: Phone,
  email: Mail,
  kakao: MessageCircle,
};

function contactHref(channel: ContactChannel, value: string): string {
  if (channel === "phone") return `tel:${value.replace(/[^0-9+]/g, "")}`;
  if (channel === "email") return `mailto:${value}`;
  return value;
}

/** 실제 검수 이력 기반 — 0건이면 아무것도 붙이지 않는다("0건"을 자랑하지 않음). */
function reviewedLabel(count: number): string | null {
  if (count >= 100) return "누적 검수 100건+";
  if (count >= 30) return "누적 검수 30건+";
  if (count > 0) return `누적 검수 ${count}건`;
  return null;
}

export function ExpertAvatar({
  expert,
  className,
}: {
  expert: Pick<ExpertCard, "displayName" | "avatarUrl" | "avatarColor">;
  className?: string;
}) {
  return (
    <Avatar className={className}>
      {expert.avatarUrl && <AvatarImage src={expert.avatarUrl} alt={expert.displayName} />}
      <AvatarFallback
        style={{ backgroundColor: expert.avatarColor ?? "var(--brand-blue)" }}
      >
        {expert.displayName.slice(0, 2)}
      </AvatarFallback>
    </Avatar>
  );
}

export function ExpertCardView({
  expert,
  selected = false,
  onSelect,
  onToggleLike,
  likeBusy = false,
}: {
  expert: ExpertCard;
  selected?: boolean;
  /** 없으면 선택 불가(미리보기). */
  onSelect?: () => void;
  /** 없으면 하트는 표시만(미리보기). */
  onToggleLike?: () => void;
  likeBusy?: boolean;
}) {
  const visibleQualifications = expert.qualifications.slice(0, 2);
  const overflow = expert.qualifications.length - visibleQualifications.length;
  const reviewed = reviewedLabel(expert.reviewedCount);
  // 공개인데 값이 비었으면 줄을 만들지 않는다. "수락 후 공개"는 값이 가려져 와도 표시.
  const contacts = CONTACT_CHANNELS.filter((ch) => {
    const c = expert.contacts[ch];
    return c.visibility === "after_accept" || (c.visibility === "public" && c.value);
  });
  const selectable = Boolean(onSelect);

  return (
    <div
      role={selectable ? "button" : undefined}
      tabIndex={selectable ? 0 : undefined}
      aria-pressed={selectable ? selected : undefined}
      aria-label={selectable ? `${expert.displayName} 세무사 선택` : undefined}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (!onSelect) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "w-full rounded-xl border p-4 text-left transition-colors",
        selectable &&
          "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : selectable && "hover:border-primary/40 hover:bg-muted/40",
      )}
    >
      <div className="flex items-start gap-3">
        <ExpertAvatar expert={expert} className="size-14 ring-2 ring-background" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{expert.displayName}</span>
            {expert.yearsExperience > 0 && (
              <span className="text-xs text-muted-foreground">
                경력 {expert.yearsExperience}년
              </span>
            )}
            {expert.reviewedThisCase && (
              <Badge variant="secondary" className="text-[10px]">
                이 상담 검수
              </Badge>
            )}
          </div>
          {expert.bio && (
            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{expert.bio}</p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {onToggleLike ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleLike();
                }}
                onKeyDown={(e) => e.stopPropagation()}
                disabled={likeBusy}
                aria-pressed={expert.likedByMe}
                aria-label={expert.likedByMe ? "하트 취소" : "하트 누르기"}
                className="-mx-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 transition hover:bg-rose-500/10 disabled:opacity-60"
              >
                <Heart
                  className={cn(
                    "size-3.5 text-rose-500",
                    expert.likedByMe && "fill-rose-500",
                  )}
                />
                <span className={cn(expert.likedByMe && "font-medium text-rose-600")}>
                  {expert.likeCount.toLocaleString("ko-KR")}
                </span>
              </button>
            ) : (
              <span className="inline-flex items-center gap-1">
                <Heart
                  className={cn(
                    "size-3.5 text-rose-500",
                    expert.likedByMe && "fill-rose-500",
                  )}
                />
                {expert.likeCount.toLocaleString("ko-KR")}
              </span>
            )}
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <span
                className={cn("size-1.5 rounded-full", AVAILABILITY_DOT[expert.availability])}
              />
              {AVAILABILITY_LABEL[expert.availability]}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1">
            {visibleQualifications.map((q) => (
              <Badge key={q} variant="outline" className="text-[10px]">
                {q}
              </Badge>
            ))}
            {overflow > 0 && (
              <Badge variant="outline" className="text-[10px]">
                +{overflow}
              </Badge>
            )}
            {expert.specialties.slice(0, 2).map((s) => (
              <Badge key={s} variant="secondary" className="text-[10px]">
                {s}
              </Badge>
            ))}
            {reviewed && (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <Award className="size-3" />
                {reviewed}
              </Badge>
            )}
          </div>

          {contacts.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 border-t pt-2 text-xs">
              {contacts.map((ch) => {
                const Icon = CONTACT_ICON[ch];
                const c = expert.contacts[ch];
                return (
                  <li key={ch} className="flex min-w-0 items-center gap-1.5">
                    <Icon className="size-3 shrink-0 text-muted-foreground" />
                    <span className="shrink-0 text-muted-foreground">{CONTACT_LABEL[ch]}</span>
                    {c.value ? (
                      <a
                        href={contactHref(ch, c.value)}
                        target={ch === "kakao" ? "_blank" : undefined}
                        rel={ch === "kakao" ? "noopener noreferrer" : undefined}
                        onClick={(e) => e.stopPropagation()}
                        className="truncate text-foreground underline-offset-2 hover:underline"
                      >
                        {ch === "kakao" ? "채팅방 열기" : c.value}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">상담 수락 후 공개</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
