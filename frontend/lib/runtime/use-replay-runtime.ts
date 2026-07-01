"use client";

import {
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import type { Message } from "../conversation-schema";
import { useReplayStore } from "../replay-store";

/**
 * 내 Message → assistant-ui ThreadMessageLike 변환.
 * content는 fallback용(텍스트 합본); 실제 렌더는 byId 조회로 세그먼트 단위 커스텀.
 */
function convertMessage(m: Message): ThreadMessageLike {
  return {
    role: m.role,
    id: m.id,
    content: [{ type: "text", text: m.segments.map((s) => s.text).join("\n") }],
  };
}

export function useReplayRuntime() {
  const visible = useReplayStore((s) => s.visible);
  const isRunning = useReplayStore((s) => s.isRunning);
  const sendNext = useReplayStore((s) => s.sendNext);

  return useExternalStoreRuntime({
    messages: visible,
    isRunning,
    convertMessage,
    onNew: async () => {
      // 입력 내용과 무관하게 스크립트를 결정적으로 진행
      sendNext();
    },
  });
}
