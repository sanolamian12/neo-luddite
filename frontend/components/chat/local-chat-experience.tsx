"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { MessagesSquare } from "lucide-react";
import { useAccountHydrated, useAccountStore } from "@/lib/account-store";
import { chatHref, messageText } from "@/lib/entry-chat";
import { entryChatStore, useChatScope, useEntryChat, useEntryHydrated } from "@/lib/entry-chat-store";
import { loginHref } from "@/lib/account-route";
import { getScenario } from "@/lib/prototype/backend";
import { Spinner } from "@/components/ui/spinner";
import { EntryComposer } from "./entry-composer";
import { EntryPrompts } from "./entry-prompts";
import { EntryResponse } from "./entry-response";
import styles from "./entry-chat.module.css";

export function LocalChatExperience({ conversationId }: { conversationId?: string }) {
  const router = useRouter();
  const scope = useChatScope();
  const hydrated = useEntryHydrated();
  const accountHydrated = useAccountHydrated();
  const session = useAccountStore((state) => state.session);
  const conversation = useEntryChat((state) => state.conversations.find((item) => item.id === conversationId && item.scope === scope));
  const pending = useEntryChat((state) => Boolean(conversationId && state.pending[conversationId]));
  const error = useEntryChat((state) => conversationId ? state.errors[conversationId] : undefined);
  const creating = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const ready = hydrated && accountHydrated;
  const hasConversation = Boolean(conversation);

  useEffect(() => {
    if (!ready || conversationId || creating.current) return;
    creating.current = true;
    router.replace(chatHref(entryChatStore.getState().create(scope)));
  }, [ready, conversationId, scope, router]);

  useEffect(() => {
    const container = scroll.current;
    if (!container) return;
    const replies = container.querySelectorAll<HTMLElement>('[data-role="assistant"]');
    const latestReply = replies.item(replies.length - 1);
    // A structured reply can exceed the viewport. Start at its answer, not its footer.
    const top = !pending && latestReply
      ? container.scrollTop + latestReply.getBoundingClientRect().top - container.getBoundingClientRect().top
      : container.scrollHeight;
    container.scrollTo({ top, behavior: "instant" });
  }, [conversationId, conversation?.messages.length, pending]);

  useEffect(() => {
    if (ready && hasConversation) input.current?.focus({ preventScroll: true });
  }, [ready, conversationId, hasConversation]);

  if (!ready || !conversationId) return <div className={styles.empty}><Spinner label="대화를 불러오는 중…" /></div>;
  if (!conversation) return <div className={styles.empty}><h1>이 대화를 열 수 없어요</h1><p>다른 계정의 대화이거나 이 브라우저에 보관된 대화가 아닙니다.</p><Link href="/">새 질문 시작하기</Link></div>;

  const interrupted = conversation.messages.at(-1)?.role === "user" && !pending;
  const returnTo = chatHref(conversation.id);
  function send() { void entryChatStore.getState().send(conversation!.id, scope, getScenario()); }
  function setDraft(text: string) { entryChatStore.getState().setDraft(conversation!.id, scope, text); }

  return <div className={styles.workspace}>
    <div className={styles.context}>
      <span>병의원 상담 예시 · {session === "viewer" ? "내 상담" : "체험 대화"}</span>
      {session === null ? <Link href={loginHref(returnTo)}>로그인하고 이 대화 이어가기</Link> : <span>이 브라우저에 보관됩니다</span>}
    </div>
    <div ref={scroll} className={styles.transcript}>
      {conversation.messages.length === 0 ? <div className={styles.empty}>
        <h1>어떤 일이 있으셨나요?</h1><p>한 문장으로 시작해도 괜찮아요.<br />상황을 함께 정리해 볼게요.</p>
        <EntryPrompts onSelect={(text) => { setDraft(text); input.current?.focus(); }} />
      </div> : <div className={styles.messages} role="log" aria-label="상담 대화" aria-live="polite" aria-relevant="additions text">
        {conversation.messages.map((message) => <div className={styles.message} data-role={message.role} key={message.id}>
          {message.role === "assistant" ? <div className={styles.messageLabel}><MessagesSquare size={16} />세무상담 · 샘플 응답</div> : <span className="sr-only">나의 질문: </span>}
          {message.role === "assistant"
            ? <EntryResponse message={message} conversation={conversation} showHandoff={!pending && !interrupted && message.id === conversation.messages.at(-1)?.id} />
            : messageText(message)}
        </div>)}
        {pending && <div className={styles.waiting} role="status"><Spinner size="sm" />질문을 살펴보고 있어요…</div>}
        {interrupted && <div className={styles.recovery} role="alert"><p>{error ?? "응답이 중단되었어요. 질문은 보관되어 있습니다."}</p><button onClick={() => void entryChatStore.getState().retry(conversation.id, scope)}>응답 다시 받기</button></div>}
      </div>}
    </div>
    <div className={styles.workspaceComposer}>
      <EntryComposer inputRef={input} value={conversation.draft} onChange={setDraft} onSend={send} busy={pending || interrupted} />
      <p>샘플 응답으로 상담 흐름을 체험합니다. 실제 세무 판단을 제공하지 않습니다.</p>
    </div>
  </div>;
}
