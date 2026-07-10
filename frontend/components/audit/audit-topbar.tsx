"use client";

import { Download } from "lucide-react";
import type { Conversation } from "@/lib/conversation-schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  conversationStatus,
  evaluationFor,
  useAuditHydrated,
  useAuditStore,
  type ConversationStatus,
} from "@/lib/audit-store";
import { useAccountStore } from "@/lib/account-store";
import { getOccupation } from "@/lib/occupations";

const STATUS_BADGE: Record<
  ConversationStatus,
  { label: string; variant: "default" | "secondary" | "outline" }
> = {
  untouched: { label: "미검토", variant: "outline" },
  in_progress: { label: "검토중", variant: "secondary" },
  completed: { label: "평가 완료", variant: "default" },
};

/**
 * 워크스페이스 상단 — 제목·페르소나·세금 카테고리·상태·내보내기.
 * 구 `audit-summary.tsx` 의 카운트/내보내기 기능을 흡수.
 */
export function AuditTopbar({
  conversationId,
  conversation,
}: {
  conversationId: string;
  conversation: Conversation;
}) {
  const feedback = useAuditStore((s) => s.feedback);
  const evaluations = useAuditStore((s) => s.evaluations);
  const auditorId = useAccountStore((s) => s.auditor.id);
  const hydrated = useAuditHydrated();

  const status = hydrated
    ? conversationStatus({ feedback, evaluations }, conversationId, auditorId)
    : "untouched";
  const items = feedback.filter((f) => f.conversationId === conversationId);
  const evaluation = evaluationFor(evaluations, conversationId, auditorId);
  const occ = getOccupation(conversation.persona.occupation);

  const onExport = () => {
    const data = {
      conversationId,
      feedback: items,
      evaluation,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-${conversationId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const meta = STATUS_BADGE[status];

  return (
    <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold leading-tight">
          {conversation.topic.title}
        </h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {occ ? `${occ.emoji} ${occ.label}` : conversation.persona.label}
          {" · "}
          {conversation.topic.taxCategory}
        </p>
      </div>

      {hydrated && (
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary" className="text-[10px]">
            피드백 {items.length}
          </Badge>
          <Badge variant={meta.variant} className="text-[10px]">
            {meta.label}
          </Badge>
        </div>
      )}

      <Button
        size="sm"
        variant="outline"
        onClick={onExport}
        className="shrink-0"
      >
        <Download className="size-3.5" />
        <span className="hidden md:inline">내보내기</span>
      </Button>
    </header>
  );
}
