"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { Radio, ScrollText } from "lucide-react";
import { getConversations, getConversationKeyById } from "@/lib/load-conversation";
import { getOccupation } from "@/lib/occupations";
import { useReplayStore } from "@/lib/replay-store";
import { useReplayRuntime } from "@/lib/runtime/use-replay-runtime";
import { isRemoteChatConfigured } from "@/services/chat";
import { ChatThread, type StarterItem } from "./thread";
import { RemoteChatExperience } from "./remote-chat-experience";
import { usePoolHydrated } from "@/lib/pool-store";
import * as poolService from "@/services/pool";

type ChatMode = "replay" | "remote";

/** 토글 기본값 — NEXT_PUBLIC_CHAT_MODE="remote" 일 때만 라이브로 출발(데모 안전). */
function defaultMode(): ChatMode {
  return process.env.NEXT_PUBLIC_CHAT_MODE === "remote" ? "remote" : "replay";
}

/**
 * 챗 경험 셀렉터 — 재생(replay)/라이브(remote) 토글 병존.
 * - replay: 사전 스크립트 결정적 재생(데모 안정·오프라인). 기존 동작.
 * - remote: Seam A `/api/chat` 실제 Upstage 추론(라이브).
 */
export function ChatExperience({ occupationKey }: { occupationKey: string }) {
  const [mode, setMode] = useState<ChatMode>(defaultMode);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ModeToggle mode={mode} onChange={setMode} />
      {mode === "remote" ? (
        <RemoteChatExperience occupationKey={occupationKey} />
      ) : (
        <ReplayChatExperience occupationKey={occupationKey} />
      )}
    </div>
  );
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: ChatMode;
  onChange: (m: ChatMode) => void;
}) {
  const remoteDisabled = !isRemoteChatConfigured;
  return (
    <div className="flex items-center justify-end gap-1 border-b bg-muted/30 px-3 py-1.5">
      <span className="mr-auto text-[11px] text-muted-foreground">
        {mode === "remote" ? "라이브 (Upstage)" : "데모 재생"}
      </span>
      <button
        type="button"
        onClick={() => onChange("replay")}
        className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition ${
          mode === "replay"
            ? "bg-background font-medium shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <ScrollText className="size-3" /> 재생
      </button>
      <button
        type="button"
        onClick={() => onChange("remote")}
        disabled={remoteDisabled}
        title={remoteDisabled ? "NEXT_PUBLIC_API_BASE 미설정 — 백엔드 필요" : undefined}
        className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition disabled:opacity-40 ${
          mode === "remote"
            ? "bg-background font-medium shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Radio className="size-3" /> 라이브
      </button>
    </div>
  );
}

/**
 * 재생(replay) 챗 경험 — 직업군 대화 목록을 starter 로 노출, 클릭 시 결정적 재생.
 * PoC 후크: 1턴(user→assistant) 이상 진행된 대화는 감사 후보 풀에 자동 등록.
 */
function ReplayChatExperience({ occupationKey }: { occupationKey: string }) {
  const occ = getOccupation(occupationKey);
  const start = useReplayStore((s) => s.start);
  const reset = useReplayStore((s) => s.reset);
  const script = useReplayStore((s) => s.script);
  const visibleCount = useReplayStore((s) => s.visible.length);
  const runtime = useReplayRuntime();
  const poolHydrated = usePoolHydrated();
  const addedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    reset();
  }, [occupationKey, reset]);

  // 1턴 완료 시 풀에 자동 적재 (idempotent — 한 세션당 1회만 호출)
  useEffect(() => {
    if (!poolHydrated || !script) return;
    if (visibleCount < 2) return;
    // 풀에는 registry key 를 conversationId 로 저장한다 (감사 라우트와 동일 키).
    const registryKey = getConversationKeyById(script.id) ?? script.id;
    if (addedRef.current.has(registryKey)) return;
    addedRef.current.add(registryKey);

    const firstUser = script.messages.find((m) => m.role === "user");
    const firstUserText = firstUser?.segments[0]?.text;
    void poolService.add({
      conversationId: registryKey,
      occupation: script.persona.occupation,
      topic: script.topic.title,
      turnCount: script.messages.length,
      firstUserMessage: firstUserText?.slice(0, 120),
    });
  }, [poolHydrated, script, visibleCount]);

  const starters: StarterItem[] = useMemo(() => {
    const convs = getConversations(occ?.conversationIds ?? []);
    return convs.map((c) => ({
      id: c.id,
      label: c.starterQuestions[0]?.text ?? c.topic.title,
      onSelect: () => start(c),
    }));
  }, [occ, start]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatThread starters={starters} personaLabel={occ?.label ?? "세무 상담"} />
    </AssistantRuntimeProvider>
  );
}
