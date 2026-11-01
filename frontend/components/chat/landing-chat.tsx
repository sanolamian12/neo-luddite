"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpLeft } from "lucide-react";
import { TaxAgentAvatar } from "./consultation-identity";
import { useAccountHydrated } from "@/lib/account-store";
import { chatHref } from "@/lib/entry-chat";
import { entryChatStore, useChatScope, useEntryChat, useEntryHydrated } from "@/lib/entry-chat-store";
import { getScenario } from "@/lib/prototype/backend";
import { isPrototype } from "@/lib/data-mode";
import { EntryComposer } from "./entry-composer";
import { EntryPrompts } from "./entry-prompts";
import styles from "./entry-chat.module.css";

const exampleQuestion = "리스한 차를 가족도 쓰는데, 비용처리가 될까요?";
const heroPlaceholderQuestions = [
  "업무용 차량 유지비도 비용처리할 수 있나요?",
  "직원들 점심값은 경비로 처리할 수 있나요?",
  "부가세 신고할 때 어떤 영수증을 챙겨야 하나요?",
  "프리랜서에게 대금을 줄 때 원천징수는 어떻게 하나요?",
] as const;

export function LandingChat({ compact = false, variant = "panel" }: { compact?: boolean; variant?: "panel" | "hero" }) {
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
    starting.current = true;
    const id = entryChatStore.getState().create(scope);
    void entryChatStore.getState().send(id, scope, getScenario());
    router.push(chatHref(id));
  }
  if (variant === "hero") return <section id="consultation" tabIndex={-1} className={styles.heroChat} aria-label="로그인 없이 세무 질문 시작하기">
    <EntryComposer embedded inputRef={input} value={ready ? draft : ""} onChange={setDraft} onSend={start} disabled={!ready} placeholderExamples={heroPlaceholderQuestions} sendLabel="질문하기" />
    <button className={styles.heroExample} type="button" disabled={!ready} onClick={() => { setDraft(exampleQuestion); input.current?.focus(); }} aria-label={`예시 질문 넣기: ${exampleQuestion}`}>
      <span>질문 예시</span><span>{exampleQuestion}</span><ArrowUpLeft size={17} aria-hidden="true" />
    </button>
    <p className={styles.heroDisclosure}>{!isPrototype && <span>AI가 세법 자료를 바탕으로 답변합니다. 최종 판단은 세무사와 확인해 주세요.</span>}<span>대화는 이 브라우저에 저장됩니다.</span></p>
  </section>;
  return <section id="consultation" tabIndex={-1} className={`${styles.panel} ${styles.landingPanel}`} aria-label="바로 시작하는 세무 상담">
    <header className={styles.panelHeader}>
      <div className={styles.panelIdentity}><TaxAgentAvatar size="small" /><span>첫 질문부터, 함께</span></div>
      <span className={styles.sampleLabel}>{isPrototype ? "상담 체험" : "세무상담"}</span>
    </header>
    <div className={styles.intro}>
      <h2>어떤 일이 있으셨나요?</h2>
      <p>사업하며 생긴 질문을 편하게 적어 주세요.</p>
    </div>
    <div className={styles.composerWrap}><EntryComposer embedded inputRef={input} value={ready ? draft : ""} onChange={setDraft} onSend={start} disabled={!ready} /></div>
    <div className={styles.landingPrompts}>{compact ? <details className={styles.promptDisclosure}><summary>질문 예시 보기</summary><EntryPrompts disabled={!ready} onSelect={(text) => { setDraft(text); input.current?.focus(); }} /></details> : <EntryPrompts disabled={!ready} onSelect={(text) => { setDraft(text); input.current?.focus(); }} />}</div>
    <p className={styles.disclosure}>{isPrototype ? "미리 준비된 응답으로 상담 흐름을 체험합니다. 대화는 이 브라우저에 보관되며 실제 세무 판단을 제공하지 않습니다." : "AI가 세법 자료를 바탕으로 답변합니다. 대화는 이 브라우저에 보관되며, 최종 판단은 세무사와 확인해 주세요."}</p>
  </section>;
}
