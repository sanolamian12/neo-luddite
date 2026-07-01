"use client";

import { useEffect, useMemo, useRef } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { getConversations, getConversationKeyById } from "@/lib/load-conversation";
import { getOccupation } from "@/lib/occupations";
import { useReplayStore } from "@/lib/replay-store";
import { useReplayRuntime } from "@/lib/runtime/use-replay-runtime";
import { ChatThread, type StarterItem } from "./thread";
import { usePoolHydrated } from "@/lib/pool-store";
import * as poolService from "@/services/pool";

/**
 * 챗 경험 진입점.
 * 직업군의 대화 목록을 starter로 노출하고, 클릭 시 해당 대화를 결정적으로 재생한다.
 *
 * PoC 후크: 1턴(user→assistant) 이상 진행된 대화는 감사 후보 풀에 자동 등록.
 */
export function ChatExperience({ occupationKey }: { occupationKey: string }) {
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
      <ChatThread
        starters={starters}
        personaLabel={occ?.label ?? "세무 상담"}
      />
    </AssistantRuntimeProvider>
  );
}
