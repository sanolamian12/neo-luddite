"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Square } from "lucide-react";
import { commonAnswer, completeConsultation, expert, finishReply, returnToAgent, script, sendMessage, takeOver, type DemoMessage } from "@/lib/demo/domain";
import { withDemoPortrait } from "@/lib/demo/expert-identity";
import { EntryComposer } from "@/components/chat/entry-composer";
import { ExpertAvatar } from "@/components/expert/expert-card";
import { Button } from "@/components/ui/button";
import { AgentAvatar, ConversationIdentity, CustomerAvatar, ExpertConnection, HandoffArrival } from "./identity";
import { DemoLink, useDemo } from "./runtime";
import styles from "@/components/chat/entry-chat.module.css";
import demoCss from "./demo.module.css";
import css from "./conversation.module.css";

export function DemoConversation({ expertView = false }: { expertView?: boolean }) {
  const common = useSearchParams().get("common") === "1";
  return common && !expertView ? <CommonFollowup /> : <Consultation expertView={expertView} />;
}

function Message({ message, expertView, streaming = false, children }: { message: Pick<DemoMessage, "author" | "name" | "text"> & Partial<DemoMessage>; expertView: boolean; streaming?: boolean; children?: React.ReactNode }) {
  const { run } = useDemo()!;
  const own = expertView ? message.author === "expert" || message.author === "expert_ai" : message.author === "customer";
  return <article className={css.message} data-own={own} data-author={message.author} data-message-id={message.id} data-streaming={streaming || undefined}>
    <div className={css.messageAvatar}>{message.author === "customer" ? <CustomerAvatar /> : message.author === "expert" ? <ExpertAvatar expert={withDemoPortrait(expert(run))} className={css.replyPortrait} /> : <AgentAvatar common={message.author === "common_ai"} />}</div>
    <div className={css.messageContent}><div className={css.messageLabel}><strong>{message.name}</strong>{message.author === "expert_ai" && <span>AI</span>}{streaming && <small>답변 중</small>}</div>
      <div className={css.bubble}>{message.text ? <p className={css.messageText}>{message.text}{streaming && <span className={css.cursor} aria-hidden="true" />}</p> : <span className={css.typing} aria-label="답변을 작성하고 있습니다"><i /><i /><i /></span>}{children}</div>
      {message.interrupted && <small className={css.interrupted}>세무사가 직접 참여하여 AI 답변을 멈췄습니다.</small>}
    </div>
  </article>;
}

function Consultation({ expertView }: { expertView: boolean }) {
  const { run, act } = useDemo()!;
  const [interruptedToken, setInterruptedToken] = useState(run.pending?.id);
  const [arriving, setArriving] = useState(false);
  const scroll = useRef<HTMLDivElement>(null), follow = useRef(true), composer = useRef<HTMLTextAreaElement>(null);
  const token = run.pending?.id, visible = run.pending?.visibleChars ?? 0;
  useEffect(() => {
    if (!token || token === interruptedToken) return;
    const timer = window.setTimeout(() => act(old => finishReply(old, token, 3)), visible ? 38 : run.pending?.kind === "welcome" ? 750 : 350);
    return () => window.clearTimeout(timer);
  }, [token, visible, interruptedToken, run.pending?.kind, act]);
  useEffect(() => { const element = scroll.current; if (element && follow.current) element.scrollTo({ top: element.scrollHeight, behavior: "instant" }); }, [run.messages.length, visible, token]);
  const sendingHuman = expertView && run.controller === "expert";
  const canSend = !run.completed && (!expertView || sendingHuman);
  function send() { follow.current = true; act(old => sendMessage(old, expertView ? "expert" : "customer", expertView ? old.expertDraft : old.customerDraft)); }
  return <div className={`${styles.workspace} ${css.workspace}`} data-view={expertView ? "expert" : "customer"} data-agent-space={!!run.expertId}>
    <ConversationIdentity run={run} expertView={expertView} />
    {expertView && <div className={css.expertControls}>
      {!run.expertId ? <p>고객이 세무사를 선택하면 이곳에 상담이 연결됩니다.</p> : run.completed ? <><span>상담 완료 · 이 대화를 다음 상담의 지식으로 남겨보세요.</span><DemoLink href="/audit/agents/teach?method=session">이 상담으로 가르치기 →</DemoLink></> : <><div><strong>{run.controller === "expert" ? "세무사님이 직접 답변하고 있습니다" : run.requested ? "고객에게 직접 검토가 필요합니다" : "AI가 상담을 이어가고 있습니다"}</strong><p>{run.controller === "expert" ? "AI는 잠시 멈춥니다. 아래 입력창의 답변은 세무사님의 이름으로 전송됩니다." : "같은 대화를 보며, 언제든 직접 답변할 수 있습니다."}</p></div><div className={css.controlActions}>{run.controller !== "expert" ? <Button onClick={() => act(takeOver)}>직접 답변 시작</Button> : <Button variant="outline" onClick={() => act(returnToAgent)}>AI에게 돌려주기</Button>}<Button variant="outline" disabled={!run.messages.some(item => item.author === "expert")} onClick={() => act(completeConsultation)}>상담 완료</Button></div></>}
    </div>}
    <div ref={scroll} className={css.transcript} onScroll={() => { const el = scroll.current; if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; }}>
      {!run.messages.length ? <div className={styles.empty}><AgentAvatar large /><h1>어떤 일이 있으셨나요?</h1><p>상황을 한 문장으로 알려 주세요.</p><Button variant="outline" onClick={() => act(old => ({ ...old, customerDraft: script.opening }))}>태블릿 사용 상담으로 시작</Button></div> : <div className={css.messages} role="log" aria-label="상담 대화" aria-live={run.pending ? "off" : "polite"}>
        {run.messages.map(message => message.author === "system" ? message.text.includes("AI가 참여했습니다") && !expertView ? <HandoffArrival key={message.id} run={run} animate={arriving} /> : <p key={message.id} className={css.event}>{message.text}</p> : <Message key={message.id} message={message} expertView={expertView}>
          {message.knowledgeId && <details className={demoCss.source}><summary>세무사의 상담 기준 보기</summary><p>{run.agent.practice.cases.find(item => item.id === message.knowledgeId)?.title}<br />{run.agent.practice.cases.find(item => item.id === message.knowledgeId)?.judgment}</p></details>}
        </Message>)}
        {run.pending && <><Message expertView={expertView} streaming={token !== interruptedToken} message={{ author: run.pending.author, name: run.pending.author === "common_ai" ? "공통 AI" : run.agent.name, text: Array.from(run.pending.reply).slice(0, visible).join("") }} />{token === interruptedToken && <div className={css.recovery} role="status"><p>작성 중이던 답변을 보관했습니다.</p><Button variant="outline" onClick={() => setInterruptedToken(undefined)}>응답 이어받기</Button></div>}</>}
        {run.recommended && !run.expertId && !expertView && <ExpertConnection onConnected={() => { setArriving(true); follow.current = true; requestAnimationFrame(() => composer.current?.focus({ preventScroll: true })); }} />}
        {run.requested && !expertView && <p className={css.event}>세무사에게 직접 검토를 요청했습니다. 대화는 이곳에서 이어집니다.</p>}
        {run.completed && <p className={css.event}>상담이 완료되었습니다. 이전 대화는 그대로 보관됩니다.</p>}
      </div>}
    </div>
    {canSend && <div className={`${styles.workspaceComposer} ${css.composer}`}><EntryComposer inputRef={composer} placeholder={expertView ? "고객에게 전할 답변을 적어 주세요…" : undefined} value={expertView ? run.expertDraft : run.customerDraft} onChange={value => act(old => ({ ...old, [expertView ? "expertDraft" : "customerDraft"]: value }))} onSend={send} busy={!!run.pending} /><p>{expertView ? "세무사의 직접 답변으로 표시됩니다." : run.controller === "expert" ? "세무사가 직접 상담하고 있습니다." : "가상 상담 · 준비된 상담 시나리오로 응답합니다."}</p></div>}
    <span className="sr-only" role="status">{run.pending ? "AI가 답변을 작성하고 있습니다." : "답변 작성이 완료되었습니다."}</span>
  </div>;
}

function CommonFollowup() {
  const { run, act } = useDemo()!;
  const answer = commonAnswer(run, run.commonQuery);
  const text = [answer.text, answer.questions].filter(Boolean).join("\n\n");
  const [visible, setVisible] = useState<number | null>(null);
  const length = Array.from(text).length, streaming = visible !== null && visible < length;
  useEffect(() => { if (!streaming) return; const timer = window.setTimeout(() => setVisible(old => Math.min(length, (old ?? 0) + 3)), visible ? 38 : 350); return () => window.clearTimeout(timer); }, [streaming, visible, length]);
  return <div className={`${styles.workspace} ${css.workspace}`} data-view="customer"><div className={css.identity}><div className={css.spaceIdentity}><AgentAvatar common /><div><h1>공통 AI</h1><p>공통 지식 버전 {run.kbVersion} · 새 대화</p></div></div></div><div className={css.transcript}><div className={css.messages}><h1 className="text-2xl font-semibold">함께 배운 지식으로, 다음 상담을.</h1><p className={demoCss.note}>배치에 반영된 공유 지식만 참고합니다. 세무사의 비공개 지식은 포함되지 않습니다.</p>{run.commonQuery && <><Message expertView={false} message={{ author: "customer", name: "고객", text: run.commonQuery }} /><Message expertView={false} streaming={streaming} message={{ author: "common_ai", name: "공통 AI", text: visible === null ? text : Array.from(text).slice(0, visible).join("") }}>{!streaming && answer.source && <details className={demoCss.source} open><summary>함께 만든 지식 · {answer.source.title}</summary><p>기여자 {answer.source.author} · 공통 지식 버전 {answer.source.version}</p><span>기여 ID {answer.source.id}</span></details>}</Message></>}</div></div><div className={`${styles.workspaceComposer} ${css.composer}`}><EntryComposer value={run.commonDraft} onChange={commonDraft => act(old => ({ ...old, commonDraft }))} busy={streaming} onSend={() => { if (act(old => ({ ...old, commonQuery: old.commonDraft, commonDraft: "", scene: "C5" }))) setVisible(0); }} />{streaming && <button className={css.finishStreaming} onClick={() => setVisible(length)}><Square size={12} />전체 답변 보기</button>}</div></div>;
}
