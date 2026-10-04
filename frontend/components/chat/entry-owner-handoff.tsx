"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Handshake, ChevronDown } from "lucide-react";
import type { EntryConversation } from "@/lib/entry-chat";
import styles from "./entry-chat.module.css";
import { isPrototype } from "@/lib/data-mode";

const ExpertHandoff = dynamic(() => import("./expert-handoff-block").then((module) => module.ExpertHandoffBlock), { loading: () => <p role="status">세무사 목록을 준비하는 중…</p> });

export function EntryOwnerHandoff({ conversation }: { conversation: EntryConversation }) {
  const [expanded, setExpanded] = useState(false);
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

  return <div className={styles.ownerHandoff}>
    <button className={styles.handoffToggle} onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
      <Handshake size={18} /><span>이 대화로 세무사 상담 준비하기</span><ChevronDown size={16} />
    </button>
    {expanded && <div className={styles.handoffContent}>
      {savedVersion === version ? <ExpertHandoff conversationId={conversation.id} block={isPrototype ? { kind: "expert_handoff", reason: "지금까지 정리한 상황을 샘플 세무사에게 전달해 보세요.", note: "프로토타입 체험입니다. 실제 상담 신청은 전송되지 않습니다." } : { kind: "expert_handoff", reason: "지금까지 정리한 상황을 세무사에게 전달해 상담을 신청할 수 있어요." }} />
        : failedVersion === version ? <div className={styles.recovery} role="alert"><p>상담 연결을 준비하지 못했어요. 대화는 보관되어 있습니다.</p><button onClick={() => { setFailedVersion(""); setAttempt((value) => value + 1); }}>다시 준비하기</button></div>
          : <p role="status">대화를 상담 기록에 연결하는 중…</p>}
    </div>}
  </div>;
}
