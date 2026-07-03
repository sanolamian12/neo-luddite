"use client";

import { useEffect, useMemo } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { AlertTriangle } from "lucide-react";
import { getConversations } from "@/lib/load-conversation";
import { getOccupation } from "@/lib/occupations";
import { useRemoteRuntime } from "@/lib/runtime/use-remote-runtime";
import { useRemoteChatStore } from "@/lib/runtime/remote-chat-store";
import { sendRemoteMessage } from "@/lib/runtime/remote-chat-send";
import { useAccountStore } from "@/lib/account-store";
import { ChatThread, type StarterItem } from "./thread";

/**
 * 라이브 챗 경험 — Seam A `/api/chat` 로 실제 Upstage 추론을 태우는 경로.
 *
 * 재생(ReplayChatExperience)과 대비: starter 는 미리 작성된 스크립트를 재생하지 않고
 * 실제 질문으로 한 턴을 전송한다. composer 입력도 그대로 추론에 반영된다.
 */
export function RemoteChatExperience({ occupationKey }: { occupationKey: string }) {
  const occ = getOccupation(occupationKey);
  const runtime = useRemoteRuntime();
  const init = useRemoteChatStore((s) => s.init);
  const reset = useRemoteChatStore((s) => s.reset);
  const error = useRemoteChatStore((s) => s.error);
  const ownerId = useAccountStore((s) => s.viewer.id);
  const ownerLabel = useAccountStore((s) => s.viewer.label);

  // occupation 진입 시 새 라이브 세션 초기화 (conversationId·createdAt 발급).
  useEffect(() => {
    const createdAt = Date.now();
    const conversationId = `live-${occupationKey}-${createdAt.toString(36)}`;
    init({ conversationId, occupation: occupationKey, ownerId, ownerLabel, createdAt });
    return () => reset();
    // owner 메타 변경만으로 세션을 리셋하지 않음(진입/occupation 기준).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occupationKey, init, reset]);

  // starter: 자주 묻는 질문을 실제 첫 질문으로 전송.
  const starters: StarterItem[] = useMemo(() => {
    const convs = getConversations(occ?.conversationIds ?? []);
    return convs.map((c) => {
      const q = c.starterQuestions[0]?.text ?? c.topic.title;
      return { id: c.id, label: q, onSelect: () => void sendRemoteMessage(q) };
    });
  }, [occ]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex flex-1 flex-col overflow-hidden">
        {error ? (
          <div className="flex items-center gap-2 border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span className="flex-1">{error}</span>
          </div>
        ) : null}
        <ChatThread starters={starters} personaLabel={occ?.label ?? "세무 상담"} />
      </div>
    </AssistantRuntimeProvider>
  );
}
