"use client";

import { Badge } from "@/components/ui/badge";
import type { OfferStatus } from "@/lib/poc-schema";
import { cn } from "@/lib/utils";

/** 연결 요청(0039) 상태 라벨 — 세무사 풀 화면과 사장님 /offers 가 함께 쓴다. */
export const OFFER_STATUS_LABEL: Record<OfferStatus, string> = {
  pending: "응답 대기",
  approved: "승인됨",
  declined: "거절됨",
  withdrawn: "철회함",
  expired: "만료됨",
};

const OFFER_STATUS_CLASS: Record<OfferStatus, string> = {
  pending: "bg-brand-amber/15 text-brand-amber",
  approved: "bg-brand-green/15 text-brand-green",
  declined: "bg-muted text-muted-foreground",
  withdrawn: "bg-muted text-muted-foreground",
  expired: "bg-muted text-muted-foreground",
};

export function OfferStatusBadge({ status, className }: { status: OfferStatus; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("border-transparent", OFFER_STATUS_CLASS[status], className)}
      data-testid="offer-status"
    >
      {OFFER_STATUS_LABEL[status]}
    </Badge>
  );
}

/** 사장님이 거절할 때 고르는 사유 — 세무사에게 메일로 간다. */
export const DECLINE_REASONS = [
  "이미 다른 세무사와 상담 중입니다",
  "지금은 세무사 상담이 필요하지 않습니다",
  "요청하신 분야와 제 상황이 맞지 않습니다",
] as const;
