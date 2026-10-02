"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { MessagesSquare } from "lucide-react";
import { useAccountHydrated } from "@/lib/account-store";
import { chatHref } from "@/lib/entry-chat";
import { entryChatStore, useChatScope, useEntryChat, useEntryHydrated } from "@/lib/entry-chat-store";
import { getScenario } from "@/lib/prototype/backend";
import { isPrototype } from "@/lib/data-mode";
import { loginHref } from "@/lib/account-route";
import { EntryComposer } from "./entry-composer";
import { EntryPrompts } from "./entry-prompts";
import styles from "./entry-chat.module.css";

export function LandingChat() {
  const router = useRouter();
  const scope = useChatScope();
  const chatHydrated = useEntryHydrated();
  const accountHydrated = useAccountHydrated();
  const ready = chatHydrated && accountHydrated;
  const draft = useEntryChat((state) => state.landingDrafts[scope] ?? "");
  const input = useRef<HTMLTextAreaElement>(null);
  const starting = useRef(false);
  function setDraft(text: string) { entryChatStore.getState().setLandingDraft(scope, text); }
  function start() {
    if (!ready || !draft.trim() || starting.current) return;
    if (!isPrototype) { router.push(loginHref(chatHref())); return; }
    starting.current = true;
    const id = entryChatStore.getState().create(scope);
    void entryChatStore.getState().send(id, scope, getScenario());
    router.push(chatHref(id));
  }
  return <section className={styles.panel} aria-label="바로 시작하는 세무 상담">
    <header className={styles.panelHeader}>
      <div className={styles.panelIdentity}><MessagesSquare size={20} /><span>첫 질문부터, 함께</span></div>
      <span className={styles.sampleLabel}>병의원 상담 예시</span>
    </header>
    <div className={styles.intro}>
      <h2>어떤 일이 있으셨나요?</h2>
      <p>정리되지 않은 이야기여도 괜찮아요.<br />궁금한 상황을 한 문장으로 시작해 보세요.</p>
      <EntryPrompts disabled={!ready} onSelect={(text) => { setDraft(text); input.current?.focus(); }} />
    </div>
    <div className={styles.composerWrap}><EntryComposer embedded inputRef={input} value={ready ? draft : ""} onChange={setDraft} onSend={start} disabled={!ready} /></div>
    <p className={styles.disclosure}>샘플 응답으로 상담 흐름을 체험합니다. 대화는 이 브라우저에 보관되며 실제 세무 판단을 제공하지 않습니다.</p>
  </section>;
}
