"use client";

import { useAccountStore } from "@/lib/account-store";
import { loginHref } from "@/lib/account-route";
import { chatHref, type EntryConversation } from "@/lib/entry-chat";
import type { Message } from "@/lib/conversation-schema";
import { ChatResponse } from "./chat-response";
import { ExpertHandoffBlock } from "./expert-handoff-block";
import { EntryOwnerHandoff } from "./entry-owner-handoff";

export function LiveEntryResponse({ message, conversation, showHandoff }: {
  message: Message; conversation: EntryConversation; showHandoff: boolean;
}) {
  const session = useAccountStore((state) => state.session);
  const block = message.uiBlocks?.find((item) => item.kind === "expert_handoff");
  // Owners retain automatic conversation saving and manual consultation requests,
  // even when the API reply does not contain a handoff recommendation.
  const handoff = !showHandoff ? null : session === "viewer"
    ? <EntryOwnerHandoff conversation={conversation} block={block} />
    : block ? <ExpertHandoffBlock conversationId={null}
      requestHref={session === null ? loginHref(chatHref(conversation.id)) : undefined}
      block={{ ...block, note: session === null
        ? "세무사를 둘러보고, 로그인 후 이 대화로 상담을 신청하세요."
        : "상담 신청은 사장님 계정에서 진행할 수 있습니다." }} /> : null;
  return <ChatResponse message={message} handoff={handoff} />;
}
