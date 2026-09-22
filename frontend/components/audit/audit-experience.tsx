"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cn, middleTruncate } from "@/lib/utils";
import { conversations } from "@/lib/load-conversation";
import { useConversationLookup } from "@/lib/conversation-store";
import { useAuditStore } from "@/lib/audit-store";
import { LoadingBlock } from "@/components/ui/spinner";
import { AuditTopbar } from "./audit-topbar";
import { AuditTranscript } from "./audit-transcript";
import { QueueStrip } from "./chat-logs/queue-strip";
import { Inspector } from "./chat-logs/inspector";

/**
 * 챗 감사 워크스페이스 — Outlier 풍 3-pane.
 * 상단: AuditTopbar / 좌: QueueStrip / 중: 전사 / 우: Inspector(탭).
 *
 * 정적 데모 번들 id 는 곧바로, 라이브 id 는 대화 스토어를 구독해 그린다(없으면 DB 에서 한 번 당김 — §3.7).
 * 원문은 정지 스냅샷 우선(`snapshotPayload ?? payload`, 검수와 같은 기준).
 */
export function AuditExperience({ conversationId }: { conversationId: string }) {
  const staticConv = conversations[conversationId];
  const { record, settled } = useConversationLookup(staticConv ? null : conversationId);
  const conv = staticConv ?? (record ? (record.snapshotPayload ?? record.payload) : null);
  const selectSegment = useAuditStore((s) => s.selectSegment);
  // 모바일(<md)에서는 3-pane 을 동시에 못 띄우므로 탭으로 전환.
  const [mobileTab, setMobileTab] = useState<"queue" | "transcript" | "inspector">(
    "transcript",
  );

  // 대화 전환 시 이전 선택 초기화
  useEffect(() => {
    selectSegment(null);
  }, [conversationId, selectSegment]);

  if (!conv) {
    if (!settled) return <LoadingBlock label="로딩 중…" className="flex-1" />;
    // 없는 id · 권한 밖(세무사는 0040 조건에 걸린 대화만 읽는다) — 같은 안내.
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm" title={conversationId}>
          대화를 찾을 수 없습니다: {middleTruncate(conversationId)}
        </p>
        <p className="text-xs break-keep text-muted-foreground">
          없는 대화이거나 볼 수 있는 대화가 아닙니다.
        </p>
        <Link href="/audit/chat-logs" className="text-sm underline">
          챗 로그 목록으로
        </Link>
      </div>
    );
  }

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
