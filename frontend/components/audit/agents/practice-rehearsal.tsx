"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Bot, Check, ChevronRight, CirclePause, MessageCircle, Play, RotateCcw, Send, UserRound } from "lucide-react";
import { canAgentReply, rehearse, replyAsAgent, replyAsExpert, requestReview, returnToAgent, takeOver, variationLabels, type Practice, type Rehearsal, type Review, type Variation } from "@/lib/agent-practice";
import { Empty, SectionTitle, TextField } from "./practice-ui";
import styles from "./agent-practice.module.css";

export interface PreviewState { phase: number; query: string; variation: Variation; run: Rehearsal | null }
export const initialPreview = (): PreviewState => ({ phase: 0, query: "업무용 장비를 구입했는데 어떤 자료를 준비하면 될까요?", variation: "normal", run: null });
const speakers = { client: "고객", agent: "전문가의 AI", expert: "전문가 직접 답변" };

function Messages({ messages, aiLabel = "전문가의 AI" }: { messages: Review["messages"]; aiLabel?: string }) {
  return <div className={styles.messages}>{messages.map((message, index) => <div className={styles.message} data-speaker={message.role} key={index}><span>{message.role === "client" ? <UserRound size={15} /> : message.role === "expert" ? <MessageCircle size={15} /> : <Bot size={16} />}{message.role === "agent" ? aiLabel : speakers[message.role]}</span><p>{message.text}</p></div>)}</div>;
}

export function PracticeRehearsal({ practice, expertName, agentName, preview, onPreview, onChange, onInbox }: { practice: Practice; expertName: string; agentName: string; preview: PreviewState; onPreview: (state: PreviewState) => void; onChange: (practice: Practice) => void; onInbox: (id: string) => void }) {
  const [error, setError] = useState("");
  const run = preview.run;
  const review = practice.reviews.find((item) => item.id === run?.id);
  function execute() {
    try {
      const next = rehearse(practice, preview.query, preview.variation);
      if (review) { next.id = review.id; onChange(replyAsAgent(practice, review.id, next)); }
      onPreview({ ...preview, run: next }); setError("");
    } catch (issue) { setError(issue instanceof Error ? issue.message : "미리보기를 실행하지 못했습니다."); }
  }
  function request() { if (!run) return; try { onChange(requestReview(practice, run)); setError(""); } catch { setError("요청함이 가득 찼습니다. 다른 에이전트에서 새 미리보기를 시작해 주세요."); } }
  const messages = review?.messages ?? (run ? [{ role: "client" as const, text: run.query }, { role: "agent" as const, text: [run.answer, ...run.questions].join("\n") }] : []);
  return <>
    <SectionTitle title="고객의 입장에서 미리보기" description="공통 AI에서 나의 AI로, 그리고 직접 상담까지 경험해 보세요." action={<button type="button" className={styles.secondary} onClick={() => { onPreview(initialPreview()); setError(""); }}><RotateCcw size={15} />새 대화</button>} />
    <div className={styles.rehearsalNote}><span className={styles.badge}>시뮬레이션</span><p>실제 고객에게 전송되지 않습니다. 저장한 사례와 선택한 상황으로 응답을 구성합니다.</p></div>
    <ol className={styles.journey} aria-label="고객 상담 여정">{["공통 AI", "전문가 선택", "전문가의 AI · 직접 참여"].map((label, index) => <li key={label} data-active={preview.phase === index}><span>{index < preview.phase ? <Check size={14} /> : index + 1}</span>{label}{index < 2 && <ChevronRight size={16} />}</li>)}</ol>
    <div className={styles.rehearsalGrid}>
      <section className={styles.paper} aria-label="상담 대화 미리보기">
        {preview.phase === 0 ? <>
          <div className={styles.chatHeader}><Bot size={22} /><div><h3>공통 AI 상담</h3><p>전문가를 선택하기 전의 기본 상담</p></div></div>
          <Messages aiLabel="공통 AI" messages={[{ role: "client", text: preview.query }, { role: "agent", text: "개별 상황에 맞는 기준으로 상담을 이어가려면 전문가를 선택해 주세요. 선택한 전문가의 AI가 먼저 안내하고, 필요할 때 전문가의 직접 답변을 요청할 수 있습니다." }]} />
          <div className={styles.form}><TextField label="고객의 질문" value={preview.query} onChange={(query) => onPreview({ ...preview, query })} maxLength={2000} /><button type="button" className={styles.primary} onClick={() => onPreview({ ...preview, phase: 1 })}>전문가 서비스 살펴보기<ArrowRight size={16} /></button></div>
        </> : preview.phase === 1 ? <>
          <div className={styles.panelHead}><h3>상담을 이어갈 전문가</h3></div>
          <p className={styles.introCopy}>선택하면 이 전문가가 가르친 AI와 대화를 시작합니다. 직접 답변은 대화 중 별도로 요청할 수 있습니다.</p>
          <div className={styles.expertProfile}><div className={styles.avatar}><UserRound size={30} strokeWidth={1.4} /></div><div><h3>{expertName} 전문가</h3><p>{practice.policy.scope || "상담 분야를 설정해 주세요"}</p><span className={styles.rowMeta}>{practice.policy.available ? "직접 참여 가능 · 데모" : "현재 부재중 · 요청 대기 가능"}</span></div></div>
          <p className={styles.introCopy}>{practice.introduction}</p><p className={styles.hint}>현재 편집 중인 전문가 서비스 한 곳을 체험하는 미리보기입니다.</p>
          <div className={styles.formFooter}><button type="button" className={styles.secondary} onClick={() => onPreview({ ...preview, phase: 0 })}>이전</button><button type="button" className={styles.primary} onClick={() => onPreview({ ...preview, phase: 2 })}>이 전문가의 AI와 시작<ArrowRight size={16} /></button></div>
        </> : <>
          <div className={styles.chatHeader}><Bot size={23} /><div><h3>{agentName}</h3><p>{expertName} 전문가의 AI · {review?.status === "human" ? "전문가 참여로 AI 일시 정지" : "AI가 응답합니다"}</p></div></div>
          {review && <div className={styles.conversationStatus} role="status">{review.status === "human" ? <><CirclePause size={16} />전문가가 직접 답변하고 있습니다.</> : review.status === "waiting" ? <><UserRound size={16} />{practice.policy.available ? "전문가에게 직접 답변을 요청했습니다." : "전문가가 부재중입니다. 요청은 대기 중입니다."}</> : <><Bot size={16} />전문가가 AI에 대화를 돌려주었습니다.</>}<button className={styles.textButton} type="button" onClick={() => onInbox(review.id)}>요청함 확인<ArrowRight size={14} /></button></div>}
          {messages.length ? <Messages messages={messages} /> : <div className={styles.chatWelcome}><p>{practice.introduction}</p><span>앞에서 입력한 질문을 가져왔습니다. 아래에서 상황을 바꿔 시험해 보세요.</span></div>}
          {run?.needsHuman && (!review || review.status === "resolved") && <div className={styles.humanSuggestion}><UserRound size={19} /><div><strong>전문가의 판단이 필요한 순간입니다</strong><p>{run.reason}</p><button type="button" className={styles.secondary} onClick={request}>직접 답변 요청</button></div></div>}
          <div className={styles.form}>
            <label className={styles.field}>시험할 상황<select value={preview.variation} onChange={(event) => onPreview({ ...preview, variation: event.target.value as Variation })}>{Object.entries(variationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <TextField label="고객 질문" value={preview.query} onChange={(query) => onPreview({ ...preview, query })} maxLength={2000} />
            {error && <p role="alert" className={styles.error}>{error}</p>}
            <div className={styles.actions}><button type="button" className={styles.primary} disabled={!preview.query.trim() || !canAgentReply(review)} onClick={execute}><Play size={15} />{review?.status === "human" ? "전문가 참여 중" : "응답 미리보기"}</button>{run && !run.needsHuman && (!review || review.status === "resolved") && <button type="button" className={styles.secondary} onClick={request}><UserRound size={15} />직접 답변 요청</button>}</div>
          </div>
        </>}
      </section>
      <aside className={styles.evidence}>
        <h3>{run ? "이 응답이 만들어진 배경" : "두 번의 연결, 분명하게"}</h3>
        {run ? <div className={styles.knowledgeThread} key={run.id}>
          <div data-filled><span className={styles.threadPoint} /><strong>참고한 사례</strong><p>{run.caseId ? run.title : "일치하는 사례 없음"}</p><span className={styles.hint}>사용 중인 사례의 검색어와 일치하는 항목만 참고합니다.</span></div>
          <div data-filled><span className={styles.threadPoint} /><strong>사실 기반</strong><p>{run.facts}</p></div>
          <div data-filled={!!run.judgment}><span className={styles.threadPoint} /><strong>적용한 판단</strong><p>{run.judgment || "이 상황에서는 일반 결론을 보류합니다."}</p></div>
          <div data-filled={run.needsHuman}><span className={styles.threadPoint} /><strong>직접 참여 {run.needsHuman ? "권장" : "조건 확인"}</strong><p>{run.reason}</p></div>
        </div> : <div className={styles.explanation}><div><span>전문가 선택</span><p>전문가의 지식과 기준이 담긴 AI 서비스를 시작합니다.</p></div><div><span>직접 답변 요청</span><p>사람의 판단이 필요한 때, 선택한 전문가의 참여를 요청합니다.</p></div></div>}
        <p className={styles.hint}>예시는 실행 시점의 지식과 설정을 사용합니다. 자유롭게 적은 원칙의 의미를 자동 해석하거나 실제 LLM을 호출하지 않습니다.</p>
      </aside>
    </div>
  </>;
}

export function PracticeInbox({ practice, onChange, selectedId, onSelect, onPreview }: { practice: Practice; onChange: (practice: Practice) => void; selectedId: string | null; onSelect: (id: string) => void; onPreview: () => void }) {
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("active");
  const detail = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!selectedId || !window.matchMedia("(max-width: 1000px)").matches) return;
    const frame = requestAnimationFrame(() => { detail.current?.scrollIntoView({ block: "start" }); detail.current?.focus({ preventScroll: true }); });
    return () => cancelAnimationFrame(frame);
  }, [selectedId]);
  const reviews = practice.reviews.filter((review) => filter === "all" || review.status !== "resolved");
  const selected = practice.reviews.find((item) => item.id === selectedId);
  function action(operation: () => Practice) { try { onChange(operation()); setError(""); } catch (issue) { setError(issue instanceof Error ? issue.message : "변경하지 못했습니다."); } }
  return <>
    <SectionTitle title="내 판단이 필요한 대화" description="고객의 상황과 AI가 멈춘 이유를 확인하고, 필요한 순간 직접 답합니다." action={<span className={styles.badge}>미리보기 요청함</span>} />
    <div className={styles.inboxGrid}>
      <section className={styles.libraryList} aria-label="직접 참여 요청 목록"><div className={styles.listHead}><strong>{reviews.length}개의 요청</strong><select aria-label="요청 상태" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="active">확인할 대화</option><option value="all">전체 대화</option></select></div>
        {reviews.length ? reviews.map((review) => <button type="button" className={styles.knowledgeRow} aria-pressed={selected?.id === review.id} key={review.id} onClick={() => { onSelect(review.id); setReply(""); setError(""); }}><span><span className={styles.provenance}>{review.status === "waiting" ? "참여 대기" : review.status === "human" ? "직접 참여 중" : "AI에 돌려줌"}</span><strong>{review.title}</strong><span className={styles.rowMeta}>{review.reason}</span></span><ArrowRight size={16} /></button>) : <Empty title="지금은 확인할 요청이 없습니다" action={<button type="button" className={styles.secondary} onClick={onPreview}>고객 여정 시험하기<ArrowRight size={15} /></button>}>미리보기에서 직접 답변을 요청하면 이곳에서 대화를 이어갈 수 있습니다.</Empty>}
      </section>
      <section className={styles.paper} ref={detail} tabIndex={-1} aria-label="전문가 직접 참여">
        {selected ? <>
          <div className={styles.panelHead}><h3>{selected.title}</h3><span className={styles.badge}>{selected.status === "human" ? "AI 일시 정지" : selected.status === "waiting" ? "참여 대기" : "AI 응답 가능"}</span></div>
          <div className={styles.contextNote}><strong>참여가 필요한 이유</strong><p>{selected.reason}</p><details><summary>전달받은 사실 보기</summary><p>{selected.facts}</p></details></div>
          <Messages messages={selected.messages} />
          {error && <p role="alert" className={styles.error}>{error}</p>}
          {selected.status === "human" ? <div className={styles.form}>
            <TextField label="전문가로서 직접 답변" value={reply} onChange={setReply} hint="이 미리보기 대화에 전문가 이름으로 답변합니다." maxLength={3000} />
            <div className={styles.actions}><button className={styles.primary} type="button" disabled={!reply.trim()} onClick={() => { if (reply.trim()) action(() => replyAsExpert(practice, selected.id, reply)); setReply(""); }}><Send size={15} />직접 답변 보내기</button><button className={styles.secondary} type="button" onClick={() => action(() => returnToAgent(practice, selected.id))}>AI에 대화 돌려주기</button></div>
          </div> : <div className={styles.formFooter}><p className={styles.hint}>{practice.policy.available ? "직접 참여하면 AI의 응답이 멈춥니다." : "부재중입니다. 운영 원칙에서 참여 가능으로 바꿀 수 있습니다."}</p><button type="button" className={styles.primary} disabled={!practice.policy.available} onClick={() => action(() => takeOver(practice, selected.id))}><UserRound size={16} />직접 참여 시작</button></div>}
        </> : <Empty title="참여할 대화를 선택하세요">대화의 맥락과 전달받은 사실을 먼저 살펴볼 수 있습니다.</Empty>}
      </section>
    </div>
  </>;
}
