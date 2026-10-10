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
import { SegmentRenderer } from "./segment-renderer";
import { UiBlocks } from "./ui-blocks";
import { TaxAgentAvatar, SpeakerBadge } from "./consultation-identity";
import surface from "./consultation-identity.module.css";

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

function AssistantMessage() {
  const original = useOriginal();
  const instant = useReplayStore((s) => s.instant);
  return (
    <div className="flex justify-start">
      <div className={`${surface.aiBubble} max-w-[85%] px-4 py-3 text-sm`}><div className={surface.label}><TaxAgentAvatar size="small" /><strong>세무상담</strong><SpeakerBadge /></div>
        {original ? (
          <>
            <SegmentRenderer message={original} progressive={!instant} />
            <UiBlocks blocks={original.uiBlocks} />
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
      <TaxAgentAvatar size="large" />
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
            className="rounded-xl border border-input bg-card/70 px-4 py-4 text-left text-sm transition hover:border-primary hover:bg-card"
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
    <ThreadPrimitive.Root className={`${surface.surface} flex flex-1 flex-col overflow-hidden`}>
      <ThreadPrimitive.Viewport className="flex flex-1 flex-col gap-6 overflow-y-auto p-4 sm:p-6">
        <ThreadPrimitive.Empty>
          <StarterScreen starters={starters} personaLabel={personaLabel} />
        </ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages
          components={{ UserMessage, AssistantMessage }}
        />
      </ThreadPrimitive.Viewport>

      <div className="border-t p-3">
        <ComposerPrimitive.Root className="flex items-end gap-2 rounded-2xl border border-input bg-background p-2 shadow-[var(--ds-shadow)]">
          <ComposerPrimitive.Input
            rows={1}
            placeholder="메시지를 입력하세요…"
            className="max-h-32 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
          />
          <ComposerPrimitive.Send aria-label="메시지 보내기" className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition hover:bg-[var(--ds-accent-hover)] disabled:opacity-40">
            <SendHorizontal className="size-4" />
          </ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
      </div>
    </ThreadPrimitive.Root>
  );
}
