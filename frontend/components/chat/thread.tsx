"use client";

import {
  ComposerPrimitive,
  getExternalStoreMessages,
  MessagePrimitive,
  ThreadPrimitive,
  useMessage,
} from "@assistant-ui/react";
import { SendHorizontal } from "lucide-react";
import type { Message } from "@/lib/conversation-schema";
import { useReplayStore } from "@/lib/replay-store";
import { useRemoteChatStore } from "@/lib/runtime/remote-chat-store";
import { sendRemoteMessage } from "@/lib/runtime/remote-chat-send";

/** 백엔드 pipeline_agentic.SKIP_TEXT 와 같은 문구 — 대화 기록에 사용자의 선택으로 남는다. */
const SKIP_ASK_TEXT = "이대로 답변 받기";
import { SegmentRenderer } from "./segment-renderer";
import { UiBlocks } from "./ui-blocks";

/**
 * assistant-ui 메시지 → 원본 Message(세그먼트/uiBlock) 조회.
 * 1차: replay 스토어 byId(우리가 통제하는 매핑), 2차: external store 바인딩.
 */
function useOriginal(): Message | undefined {
  const msg = useMessage();
  const fromStore = useReplayStore((s) => s.byId[msg.id]);
  if (fromStore) return fromStore;
  const bound = getExternalStoreMessages(msg) as Message[] | undefined;
  return bound?.[0];
}

function UserMessage() {
  const original = useOriginal();
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground">
        {original ? (
          <SegmentRenderer message={original} />
        ) : (
          <MessagePrimitive.Parts />
        )}
      </div>
    </div>
  );
}

/**
 * v2 되묻기 카드의 "이대로 답변 받기"(정본 A1-1) — 되묻기를 건너뛰고 빈 사실은 조건부로 답을 받는다.
 * 열린 되묻기(가장 최근 메시지가 askState 를 가진 assistant)에만, 응답 대기 중이 아닐 때만 보인다.
 */
function SkipAskButton({ message }: { message: Message }) {
  const isLatest = useRemoteChatStore((s) => s.messages.at(-1)?.id === message.id);
  const isRunning = useRemoteChatStore((s) => s.isRunning);
  if (!message.askState || !isLatest || isRunning) return null;
  return (
    <button
      type="button"
      onClick={() => void sendRemoteMessage(SKIP_ASK_TEXT, { action: "proceed_with_gap" })}
      className="mt-3 rounded-lg border px-3 py-1.5 text-xs text-muted-foreground transition hover:border-brand-blue hover:text-foreground"
    >
      {SKIP_ASK_TEXT}
    </button>
  );
}

function AssistantMessage() {
  const original = useOriginal();
  const instant = useReplayStore((s) => s.instant);
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-2xl border bg-card px-4 py-3 text-sm text-card-foreground">
        {original ? (
          <>
            <SegmentRenderer message={original} progressive={!instant} />
            <UiBlocks blocks={original.uiBlocks} />
            <SkipAskButton message={original} />
          </>
        ) : (
          <MessagePrimitive.Parts />
        )}
      </div>
    </div>
  );
}

export interface StarterItem {
  id: string;
  label: string;
  onSelect: () => void;
}

function StarterScreen({
  starters,
  personaLabel,
}: {
  starters: StarterItem[];
  personaLabel: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="space-y-1">
        <h2 className="text-2xl font-bold">무엇을 도와드릴까요?</h2>
        <p className="text-sm text-muted-foreground">
          {personaLabel} · 자주 묻는 질문으로 시작해 보세요
        </p>
      </div>
      <div className="grid w-full max-w-md gap-2">
        {starters.map((q) => (
          <button
            key={q.id}
            type="button"
            onClick={q.onSelect}
            className="rounded-xl border px-4 py-3 text-left text-sm transition hover:border-brand-blue hover:bg-muted"
          >
            {q.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ChatThread({
  starters,
  personaLabel,
}: {
  starters: StarterItem[];
  personaLabel: string;
}) {
  return (
    <ThreadPrimitive.Root className="flex flex-1 flex-col overflow-hidden">
      <ThreadPrimitive.Viewport className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        <ThreadPrimitive.Empty>
          <StarterScreen starters={starters} personaLabel={personaLabel} />
        </ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages
          components={{ UserMessage, AssistantMessage }}
        />
      </ThreadPrimitive.Viewport>

      <div className="border-t p-3">
        <ComposerPrimitive.Root className="flex items-end gap-2 rounded-2xl border bg-background p-2">
          <ComposerPrimitive.Input
            rows={1}
            placeholder="메시지를 입력하세요…"
            className="max-h-32 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
          />
          <ComposerPrimitive.Send className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground transition hover:bg-primary/80 disabled:opacity-40">
            <SendHorizontal className="size-4" />
          </ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
      </div>
    </ThreadPrimitive.Root>
  );
}
