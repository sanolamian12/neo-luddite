"use client";

import {
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import type { Message } from "../conversation-schema";
import { useRemoteChatStore } from "./remote-chat-store";
import { sendRemoteMessage } from "./remote-chat-send";

/**
 * 원격(라이브) 챗 런타임 — Seam A `/api/chat` 배선.
 *
 * replay 런타임과 동일하게 assistant-ui external store 를 쓰되, onNew 가 스크립트를
 * 진행하는 대신 composer 텍스트를 캡처해 실제 추론을 호출한다(remote-chat-send).
 * 렌더는 thread.tsx 가 external store 바인딩으로 원본 Message(세그먼트/uiBlock)를
 * 복원하므로 재생 경로와 완전히 동일한 UI 를 재사용한다.
 */
function convertMessage(m: Message): ThreadMessageLike {
  return {
    role: m.role,
    id: m.id,
    content: [{ type: "text", text: m.segments.map((s) => s.text).join("\n") }],
  };
}

/** AppendMessage.content 에서 사용자 입력 텍스트만 추출. */
function extractText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      part && typeof part === "object" && (part as { type?: string }).type === "text"
        ? String((part as { text?: string }).text ?? "")
        : "",
    )
    .join("")
    .trim();
}

export function useRemoteRuntime() {
  const messages = useRemoteChatStore((s) => s.messages);
  const isRunning = useRemoteChatStore((s) => s.isRunning);

  return useExternalStoreRuntime({
    messages,
    isRunning,
    convertMessage,
    onNew: async (message) => {
      await sendRemoteMessage(extractText(message.content));
    },
  });
}
