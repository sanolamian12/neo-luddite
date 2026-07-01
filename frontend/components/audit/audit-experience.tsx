"use client";

import { useEffect } from "react";
import { getConversation } from "@/lib/load-conversation";
import { useAuditStore } from "@/lib/audit-store";
import { AuditTopbar } from "./audit-topbar";
import { AuditTranscript } from "./audit-transcript";
import { QueueStrip } from "./chat-logs/queue-strip";
import { Inspector } from "./chat-logs/inspector";

/**
 * 챗 감사 워크스페이스 — Outlier 풍 3-pane.
 * 상단: AuditTopbar / 좌: QueueStrip / 중: 전사 / 우: Inspector(탭).
 */
export function AuditExperience({ conversationId }: { conversationId: string }) {
  const conv = getConversation(conversationId);
  const selectSegment = useAuditStore((s) => s.selectSegment);

  // 대화 전환 시 이전 선택 초기화
  useEffect(() => {
    selectSegment(null);
  }, [conversationId, selectSegment]);

  if (!conv) return null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <AuditTopbar conversationId={conversationId} conversation={conv} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <QueueStrip currentId={conversationId} />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <AuditTranscript
            conversationId={conversationId}
            conversation={conv}
          />
        </main>
        <Inspector conversationId={conversationId} conversation={conv} />
      </div>
    </div>
  );
}
