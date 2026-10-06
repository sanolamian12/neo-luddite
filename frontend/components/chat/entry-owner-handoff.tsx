"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { EntryConversation } from "@/lib/entry-chat";
import type { UiBlock } from "@/lib/conversation-schema";
import styles from "./entry-chat.module.css";

const ExpertHandoff = dynamic(() => import("./expert-handoff-block").then((module) => module.ExpertHandoffBlock), { loading: () => <p role="status">세무사 목록을 준비하는 중…</p> });

export function EntryOwnerHandoff({ conversation, block }: { conversation: EntryConversation; block: Extract<UiBlock, { kind: "expert_handoff" }> }) {
  const [savedVersion, setSavedVersion] = useState("");
  const [failedVersion, setFailedVersion] = useState("");
  const [attempt, setAttempt] = useState(0);
  const version = `${conversation.scope}:${conversation.id}:${conversation.messages.length}`;
  useEffect(() => {
    let active = true;
    void import("@/lib/entry-chat-owner").then(({ saveOwnerConversation }) => saveOwnerConversation(conversation)).then(() => {
      if (active) setSavedVersion(version);
    }).catch(() => { if (active) setFailedVersion(version); });
    return () => { active = false; };
    // Draft-only changes do not need to update the consultation snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, attempt]);

  return <div>
      {savedVersion === version ? <ExpertHandoff conversationId={conversation.id} block={block} />
        : failedVersion === version ? <div className={styles.recovery} role="alert"><p>상담 연결을 준비하지 못했어요. 대화는 보관되어 있습니다.</p><button onClick={() => { setFailedVersion(""); setAttempt((value) => value + 1); }}>다시 준비하기</button></div>
          : <p role="status">대화를 상담 기록에 연결하는 중…</p>}
  </div>;
}
