"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Bot, UserRound } from "lucide-react";
import { commonAnswer, completeConsultation, expert, finishReply, returnToAgent, script, selectExpert, sendMessage, takeOver } from "@/lib/demo/domain";
import { EntryComposer } from "@/components/chat/entry-composer";
import { ExpertDirectory } from "@/components/expert/expert-directory";
import { Popover, PopoverContent, PopoverPortal, PopoverPositioner, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { DemoLink, useDemo } from "./runtime";
import styles from "@/components/chat/entry-chat.module.css";
import css from "./demo.module.css";

export function DemoConversation({ expertView = false }: { expertView?: boolean }) {
  const common = useSearchParams().get("common") === "1";
  return common && !expertView ? <CommonFollowup /> : <Consultation expertView={expertView} />;
}
function Consultation({ expertView }: { expertView: boolean }) {
  const demo = useDemo()!; const { run, act } = demo;
  const [picker, setPicker] = useState(false); const [selected, setSelected] = useState<string | null>(null);
  const [interruptedToken] = useState(run.pending?.id);
  const scroll = useRef<HTMLDivElement>(null);
  const token = run.pending?.id;
  useEffect(() => { if (!token || token === interruptedToken) return; const timer = setTimeout(() => { act((old) => finishReply(old, token)); }, 650); return () => clearTimeout(timer); }, [token, interruptedToken, act]);
  useEffect(() => { const element = scroll.current; if (element) element.scrollTo({ top: element.scrollHeight, behavior: "instant" }); }, [run.messages.length, token]);
  const sendingHuman = expertView && run.controller === "expert";
  const canSend = !run.completed && (!expertView || sendingHuman);
  function send() { act((old) => sendMessage(old, expertView ? "expert" : "customer", expertView ? old.expertDraft : old.customerDraft)); }
  return <div className={styles.workspace}>
    <div className={css.participants}><strong>{run.expertId ? run.agent.name : "공통 AI"}</strong>{run.expertId && <span><UserRound className="mr-1 inline" size={14} />{expert(run).displayName} · {run.completed ? "상담 완료" : run.controller === "expert" ? "직접 답변 중 · AI 일시정지" : "참여 중"}</span>}<span className={css.note}>가상 상담 · 같은 대화에서 이어집니다</span></div>
    {expertView && <div className={`${css.participants} ${css.actions}`}>
      {!run.expertId ? <span>고객이 세무사를 선택하면 이곳에 상담이 연결됩니다.</span> : run.completed ? <DemoLink href="/audit/agents/teach?method=session">이 상담으로 가르치기 →</DemoLink> : <><span>{run.requested ? "직접 검토 요청 · 사용 기록이 부족합니다" : "대화 맥락을 함께 살펴보세요"}</span>{run.controller !== "expert" ? <Button onClick={() => act(takeOver)}>직접 답변 시작</Button> : <Button variant="outline" onClick={() => act(returnToAgent)}>AI에게 돌려주기</Button>}<Button variant="outline" disabled={!run.messages.some((item) => item.author === "expert")} onClick={() => act(completeConsultation)}>상담 완료</Button></>}
    </div>}
    <div ref={scroll} className={styles.transcript}>
      {!run.messages.length ? <div className={styles.empty}><h1>어떤 일이 있으셨나요?</h1><p>상황을 한 문장으로 알려 주세요.</p><Button variant="outline" onClick={() => act((old) => ({ ...old, customerDraft: script.opening }))}>태블릿 사용 상담으로 시작</Button></div> : <div className={styles.messages} role="log" aria-label="상담 대화" aria-live="polite">
        {run.messages.map((message) => message.author === "system" ? <p key={message.id} className={css.event}>{message.text}</p> : <article key={message.id} data-message-id={message.id} data-author={message.author} className={`${styles.message} ${message.author === "expert" ? css.human : ""}`} data-role={message.author === "customer" ? "user" : "assistant"}>
          <div className={styles.messageLabel}>{message.author === "expert" ? <UserRound size={16} /> : message.author !== "customer" ? <Bot size={16} /> : null}{message.name}</div><p className={css.messageText}>{message.text}</p>
          {message.knowledgeId && <details className={css.source}><summary>세무사의 상담 기준 보기</summary><p>{run.agent.practice.cases.find((item) => item.id === message.knowledgeId)?.title}<br />{run.agent.practice.cases.find((item) => item.id === message.knowledgeId)?.judgment}</p></details>}
        </article>)}
        {run.pending && (token === interruptedToken ? <div role="status"><p>이전 응답이 중단되었습니다. 질문은 보관되어 있습니다.</p><Button variant="outline" onClick={() => act((old) => finishReply(old, token ?? ""))}>응답 다시 받기</Button></div> : <p role="status">답변을 정리하고 있습니다…</p>)}
        {run.recommended && !run.expertId && !expertView && <Popover open={picker} onOpenChange={setPicker}><PopoverTrigger render={<Button variant="outline" />}>세무사 선택하기</PopoverTrigger><PopoverPortal><PopoverPositioner side="bottom" align="end" sideOffset={8} collisionPadding={16} collisionAvoidance={{ side: "shift", align: "shift" }}><PopoverContent aria-label="세무사 찾기" className="h-[min(740px,calc(100dvh-2rem))] w-[min(620px,calc(100vw-2rem))] overflow-hidden rounded-2xl border-0 p-0 shadow-xl"><ExpertDirectory experts={run.experts.map((item) => ({ ...item, displayName: item.displayName.replace(/ 세무사$/, "") }))} selectedId={selected} onSelect={setSelected} onRequest={() => { if (selected && act((old) => selectExpert(old, selected))) setPicker(false); }} onToggleLike={(id) => act((old) => ({ ...old, experts: old.experts.map((item) => item.auditorId === id ? { ...item, likedByMe: !item.likedByMe, likeCount: item.likedByMe ? 0 : 1 } : item) }))} likeBusyId={null} canAct={true} /></PopoverContent></PopoverPositioner></PopoverPortal></Popover>}
        {run.requested && !expertView && <p className={css.note}>세무사에게 직접 검토를 요청했습니다. 대화는 이곳에서 이어집니다.</p>}
        {run.completed && <p className={css.event}>상담이 완료되었습니다. 이전 대화는 그대로 보관됩니다.</p>}
      </div>}
    </div>
    {canSend && <div className={styles.workspaceComposer}><EntryComposer value={expertView ? run.expertDraft : run.customerDraft} onChange={(value) => act((old) => ({ ...old, [expertView ? "expertDraft" : "customerDraft"]: value }))} onSend={send} busy={!!run.pending} /><p>{expertView ? "세무사의 직접 답변으로 표시됩니다." : run.controller === "expert" ? "세무사가 직접 상담하고 있습니다." : "프로토타입 · 준비된 상담 시나리오로 응답합니다."}</p></div>}
  </div>;
}
function CommonFollowup() {
  const { run, act } = useDemo()!; const draft = run.commonDraft, query = run.commonQuery;
  const answer = commonAnswer(run, query);
  return <div className={styles.workspace}><div className={css.participants}><strong>공통 AI</strong><span>공통 지식 버전 {run.kbVersion} · 새 대화</span></div><div className={styles.transcript}><div className={styles.messages}><h1 className="text-2xl font-semibold">함께 배운 지식으로, 다음 상담을.</h1><p className={css.note}>배치에 반영된 공유 지식만 참고합니다. 세무사의 비공개 지식은 포함되지 않습니다.</p>{query && <><article className={styles.message} data-role="user">{query}</article><article className={styles.message} data-role="assistant"><div className={styles.messageLabel}><Bot size={16} />공통 AI</div><p className={css.messageText}>{answer.text}</p>{answer.questions && <p className={css.messageText}>{answer.questions}</p>}{answer.source && <details className={css.source} open><summary>함께 만든 지식 · {answer.source.title}</summary><p>기여자 {answer.source.author} · 공통 지식 버전 {answer.source.version}</p><span>기여 ID {answer.source.id}</span></details>}</article></>}</div></div><div className={styles.workspaceComposer}><EntryComposer value={draft} onChange={(commonDraft) => act((old) => ({ ...old, commonDraft }))} onSend={() => act((old) => ({ ...old, commonQuery: old.commonDraft, commonDraft: "", scene: "C5" }))} /></div></div>;
}
