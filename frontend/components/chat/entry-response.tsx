"use client";

import { useAccountStore } from "@/lib/account-store";
import { loginHref } from "@/lib/account-route";
import { chatHref, type EntryConversation } from "@/lib/entry-chat";
import type { Message } from "@/lib/conversation-schema";
import { SegmentRenderer } from "./segment-renderer";
import { UiBlocks } from "./ui-blocks";
import { ExpertHandoffBlock } from "./expert-handoff-block";
import { EntryOwnerHandoff } from "./entry-owner-handoff";
import styles from "./entry-response.module.css";

export function EntryResponse({ message, conversation, showHandoff }: {
  message: Message;
  conversation: EntryConversation;
  showHandoff: boolean;
}) {
  const session = useAccountStore((state) => state.session);
  const handoff = message.uiBlocks?.find((block) => block.kind === "expert_handoff");
  return <div className={styles.response}>
    <SegmentRenderer message={message} />
    <UiBlocks blocks={message.uiBlocks?.filter((block) => block.kind !== "expert_handoff")} />
    {handoff && showHandoff && (session === "viewer"
      ? <EntryOwnerHandoff conversation={conversation} block={handoff} />
      : <ExpertHandoffBlock conversationId={null} requestHref={session === null ? loginHref(chatHref(conversation.id)) : undefined} block={{
        ...handoff,
        note: session === null
          ? "샘플 세무사를 둘러보세요. 로그인하면 이 대화로 상담 신청을 체험할 수 있습니다."
          : "샘플 세무사 목록입니다. 상담 신청은 사장님 계정에서 체험할 수 있습니다.",
      }} />)}
  </div>;
}
