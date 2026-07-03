"use client";

import type { Message } from "../conversation-schema";
import { useRemoteChatStore } from "./remote-chat-store";
import * as chatService from "@/services/chat";
import type { Occupation } from "@/services/chat";
import * as conversationService from "@/services/conversation";

/**
 * 원격 챗 전송 액션 — 런타임 onNew 와 starter 클릭이 공유하는 단일 진입점.
 *
 * 흐름: user Message 를 즉시 노출 → `/api/chat` 호출 → assistant Message 노출.
 * React 밖(순수 함수)이라 store getState 로 동작하며, 어디서든 호출 가능.
 *
 * Phase 2(영속화)에서 assistant 노출 직후 conversation 서비스로 upsert 를 건다.
 */

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

function buildUserMessage(text: string, order: number): Message {
  return {
    id: nextId("u"),
    role: "user",
    order,
    segments: [{ id: nextId("us"), text, type: "question" }],
  };
}

/**
 * 한 턴 전송. 이미 응답 대기 중이거나 빈 텍스트면 무시.
 * 실패는 store.error 로 노출하고 throw 하지 않는다(런타임 안정성).
 */
export async function sendRemoteMessage(rawText: string): Promise<void> {
  const text = rawText.trim();
  if (!text) return;

  const store = useRemoteChatStore.getState();
  if (store.isRunning) return;

  const { conversationId, occupation } = store;
  if (!conversationId || !occupation) {
    store.setError("대화가 초기화되지 않았습니다. 새로고침 후 다시 시도하세요.");
    return;
  }

  // history = 이번 user turn 이전까지 (백엔드는 userInput 을 별도로 받는다).
  const history = store.messages;
  const userMsg = buildUserMessage(text, history.length);
  store.append(userMsg);
  store.setRunning(true);
  store.setError(null);

  try {
    const { message: assistant } = await chatService.send({
      conversationId,
      occupation: occupation as Occupation,
      history,
      text,
    });
    useRemoteChatStore.getState().append(assistant);

    // 영속화: 매 assistant 턴 후 Supabase 에 upsert(하차장 목록·세무사 원문·RAG write-path).
    // 실패해도 챗은 계속(영속화는 best-effort) — owner 로그인/RLS 미충족 시 조용히 넘어감.
    const snap = useRemoteChatStore.getState();
    if (snap.ownerId && snap.createdAt != null) {
      try {
        await conversationService.persistLive({
          conversationId,
          occupation,
          ownerId: snap.ownerId,
          ownerLabel: snap.ownerLabel,
          createdAt: snap.createdAt,
          messages: snap.messages,
        });
      } catch (persistErr) {
        console.warn("[remote-chat] 대화 영속화 실패(무시):", persistErr);
      }
    }
  } catch (err) {
    useRemoteChatStore
      .getState()
      .setError(err instanceof Error ? err.message : String(err));
  } finally {
    useRemoteChatStore.getState().setRunning(false);
  }
}
