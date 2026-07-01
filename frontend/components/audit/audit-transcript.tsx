"use client";

import { useMemo } from "react";
import type { Conversation } from "@/lib/conversation-schema";
import { UiBlocks } from "@/components/chat/ui-blocks";
import {
  feedbackCounts,
  useAuditHydrated,
  useAuditStore,
} from "@/lib/audit-store";
import { AuditSegment } from "./audit-segment";

function Bubble({
  role,
  children,
}: {
  role: "user" | "assistant";
  children: React.ReactNode;
}) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground">
          {children}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[88%] rounded-2xl border bg-card px-3 py-2 text-sm text-card-foreground">
        {children}
      </div>
    </div>
  );
}

/** 전사 직접 렌더 — assistant-ui 런타임 미사용. 문장 단위 선택.
 *  conversationId = 레지스트리 키(외래키). conversation = 렌더용 내용. */
export function AuditTranscript({
  conversationId,
  conversation,
}: {
  conversationId: string;
  conversation: Conversation;
}) {
  const selectedSegmentId = useAuditStore((s) => s.selectedSegmentId);
  const selectSegment = useAuditStore((s) => s.selectSegment);
  const feedback = useAuditStore((s) => s.feedback);
  const hydrated = useAuditHydrated();

  const counts = useMemo(
    () => (hydrated ? feedbackCounts(feedback, conversationId) : {}),
    [hydrated, feedback, conversationId],
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      {conversation.messages.map((m) => (
        <Bubble key={m.id} role={m.role}>
          <div className="flex flex-col gap-1.5" data-message-id={m.id}>
            {m.segments.map((seg) => (
              <AuditSegment
                key={seg.id}
                seg={seg}
                selected={selectedSegmentId === seg.id}
                feedbackCount={counts[seg.id] ?? 0}
                onSelect={selectSegment}
              />
            ))}
          </div>
          {m.role === "assistant" && <UiBlocks blocks={m.uiBlocks} />}
        </Bubble>
      ))}
    </div>
  );
}
