"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
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
  // 모바일(<md)에서는 3-pane 을 동시에 못 띄우므로 탭으로 전환.
  const [mobileTab, setMobileTab] = useState<"queue" | "transcript" | "inspector">(
    "transcript",
  );

  // 대화 전환 시 이전 선택 초기화
  useEffect(() => {
    selectSegment(null);
  }, [conversationId, selectSegment]);

  if (!conv) return null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <AuditTopbar conversationId={conversationId} conversation={conv} />
      {/* 모바일 탭 전환기 — 데스크톱은 3-pane 동시 표시 */}
      <div className="flex shrink-0 border-b md:hidden">
        {(
          [
            ["queue", "큐"],
            ["transcript", "전사"],
            ["inspector", "검수"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setMobileTab(id)}
            className={cn(
              "flex-1 px-3 py-2 text-sm font-medium transition",
              mobileTab === id
                ? "border-b-2 border-foreground text-foreground"
                : "text-muted-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <QueueStrip
          currentId={conversationId}
          mobileShow={mobileTab === "queue"}
        />
        <main
          className={cn(
            "min-w-0 flex-1 overflow-y-auto md:block",
            mobileTab === "transcript" ? "block" : "hidden",
          )}
        >
          <AuditTranscript
            conversationId={conversationId}
            conversation={conv}
          />
        </main>
        <Inspector
          conversationId={conversationId}
          conversation={conv}
          mobileShow={mobileTab === "inspector"}
        />
      </div>
    </div>
  );
}
