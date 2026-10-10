"use client";

import { useRef, useState } from "react";
import { ArrowRight, Check, FileText, MessageCircle, Upload } from "lucide-react";
import type { Practice } from "@/lib/agent-practice";
import { applySessionLesson, importSession, proposeLesson, sampleTranscript } from "@/lib/session-learning";
import type { SessionIntake, SessionLesson } from "@/lib/session-learning-schema";
import { useRoomStore } from "@/lib/room-store";
import { useAgentLibrary } from "./agent-library";
import { SectionTitle, TextField } from "./practice-ui";
import styles from "./agent-practice.module.css";
import css from "./knowledge-growth.module.css";
import { useDemo } from "@/components/demo/runtime";
import { DemoSourceSelector } from "@/components/demo/source-selector";

/** Optional live hooks: the live controller limits sources to pasted text and saves through the server. Defaults keep the prototype behavior. */
export type SessionTeachingLive = { transcriptOnly?: boolean; permissionLabel?: string; savedNotice?: string; memoNotice?: string; afterApply?: string };
export function SessionTeaching({ practice, onChange, onApply, onKnowledge, onContribute, live }: { practice: Practice; onChange: (next: Practice) => void; onApply: (next: Practice) => boolean | Promise<boolean>; onKnowledge: (id?: string) => void; onContribute?: (id: string) => void; live?: SessionTeachingLive }) {
  const demo = useDemo();
  const { owner } = useAgentLibrary();
  const rooms = useRoomStore((state) => state.rooms);
  const messages = useRoomStore((state) => state.messages);
  const input: SessionIntake = practice.learning?.intake ?? { title: "", transcript: "", kind: "transcript", permitted: false };
  function setInput(next: SessionIntake) { onChange({ ...practice, learning: { sessions: practice.learning?.sessions ?? [], ...practice.learning, intake: next } }); }
  const importHeading = useRef<HTMLHeadingElement>(null);
  const sourceHeading = useRef<HTMLHeadingElement>(null);
  const draftHeading = useRef<HTMLHeadingElement>(null);
  const verification = useRef<HTMLLabelElement>(null);
  function focusDraft() { requestAnimationFrame(() => { draftHeading.current?.scrollIntoView({ block: "start" }); draftHeading.current?.focus({ preventScroll: true }); }); }
  const permitted = input.permitted;
  const [issue, setIssue] = useState("");
  const [notice, setNotice] = useState("");
  const draft = practice.learning?.draft;
  const applied = !!draft && practice.cases.some((entry) => entry.id === draft.id);
  const closed = rooms.filter((room) => room.expertId === owner && room.status === "closed" && messages.some((message) => message.roomId === room.id && message.senderRole === "auditor" && !message.deletedAt));
  const reviews = practice.reviews.filter((review) => review.status === "resolved" && review.messages.some((message) => message.role === "expert"));
  function edit(patch: Partial<SessionLesson>) {
    if (!draft) return;
    setIssue(""); setNotice("");
    onChange({ ...practice, learning: { sessions: practice.learning?.sessions ?? [], draft: { ...draft, tested: false, ...patch } } });
  }
  function start() {
    try {
      const session = importSession({ ...input, permitted });
      onChange({ ...practice, learning: { sessions: practice.learning?.sessions ?? [], draft: proposeLesson(session) } });
      setIssue(""); setNotice("");
      requestAnimationFrame(() => { sourceHeading.current?.scrollIntoView({ block: "start" }); sourceHeading.current?.focus({ preventScroll: true }); });
    } catch (error) { setIssue(error instanceof Error ? error.message : "전사문을 확인해 주세요."); }
  }
  const [saving, setSaving] = useState(false);
  async function apply() {
    if (!draft || saving) return;
    setSaving(true);
    try { if (!await onApply(applySessionLesson(practice, draft))) { setIssue("저장하지 못해 지식을 반영하지 않았습니다. 상단의 오류를 확인한 뒤 다시 시도해 주세요."); return; } setIssue(""); setNotice(live?.savedNotice ?? "내 에이전트에 반영하고 원문과 지식을 이 브라우저에 저장했습니다."); }
    catch (error) { setIssue(error instanceof Error ? error.message : "검토 항목을 확인해 주세요."); }
    finally { setSaving(false); }
  }
  function source(next: Omit<SessionIntake, "permitted">) { setInput({ ...next, permitted: false }); setIssue(""); setNotice(`${next.title || "상담"} 원문을 불러왔습니다. 내용을 확인해 주세요.`); requestAnimationFrame(() => { importHeading.current?.scrollIntoView({ block: "start" }); importHeading.current?.focus({ preventScroll: true }); }); }
  async function upload(file?: File) {
    if (!file) return;
    if (!/\.(txt|md)$/i.test(file.name) || file.size > 160000) { setIssue("160KB 이하의 TXT 또는 MD 전사문을 선택해 주세요. 음성 파일은 아직 지원하지 않습니다."); return; }
    try { source({ title: file.name.replace(/\.[^.]+$/, "").slice(0, 100), transcript: await file.text(), kind: "transcript", id: undefined }); }
    catch { setIssue("파일을 읽지 못했습니다. 다시 선택하거나 전사문을 붙여 넣어 주세요."); }
  }
  if (demo && !draft) return <DemoSourceSelector onCreated={focusDraft} />;
  return <>
    {demo && <details className={styles.guidanceDetails}><summary>가르칠 대화 범위 다시 선택</summary><DemoSourceSelector onCreated={focusDraft} /></details>}
    <SectionTitle title="상담에서 배우기" description="실제 오간 질문과 답변을 펼쳐 놓고, 다음 상담에 남길 나의 판단을 골라냅니다." action={draft ? <button type="button" className={styles.secondary} onClick={() => { if (!window.confirm("작성 중인 상담 초안을 닫고 다른 상담을 선택할까요? 이미 반영한 지식과 저장된 원문은 유지됩니다.")) return; onChange({ ...practice, learning: { sessions: practice.learning?.sessions ?? [] } }); setNotice(""); setIssue(""); }}>다른 상담 선택</button> : undefined} />
    {issue && <p role="alert" className={styles.error}>{issue}</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {!draft ? <div className={css.sourceGrid}>
      <section className={css.sourceChoices} aria-label="상담 선택">
        {!live?.transcriptOnly && <>
        <h3>완료한 상담으로 시작</h3><p>전문가가 직접 답한 대화에서 배울 내용을 찾습니다.</p>
        {closed.map((room, index) => <button type="button" className={css.sourceRow} key={room.id} onClick={() => source({ id: `room-${room.id}`, title: `완료한 채팅 상담 ${index + 1}`, kind: "chat", transcript: messages.filter((message) => message.roomId === room.id && !message.deletedAt).sort((a, b) => a.createdAt - b.createdAt).map((message) => `${message.senderRole === "auditor" ? "전문가" : "고객"}: ${message.body.replace(/\n/g, " ")}`).join("\n") })}><MessageCircle size={19} /><span><strong>완료한 채팅 상담 {index + 1}</strong><small>고객과 전문가의 대화</small></span><ArrowRight size={16} /></button>)}
        {reviews.map((review) => <button type="button" className={css.sourceRow} key={review.id} onClick={() => source({ id: `review-${review.id}`, title: review.title.slice(0, 100), kind: "chat", transcript: review.messages.map((message) => `${message.role === "expert" ? "전문가" : message.role === "client" ? "고객" : "AI"}: ${message.text.replace(/\n/g, " ")}`).join("\n") })}><MessageCircle size={19} /><span><strong>{review.title}</strong><small>참여 요청에서 완료한 예시 상담</small></span><ArrowRight size={16} /></button>)}
        {!closed.length && !reviews.length && <p className={css.quietEmpty}>아직 완료한 사람 상담이 없습니다. 전사문을 가져오거나 예시로 흐름을 살펴보세요.</p>}
        <button type="button" className={css.sourceRow} onClick={() => source({ title: "장비의 업무·개인 사용을 확인한 상담", transcript: sampleTranscript, kind: "sample", id: "sample-mixed-use" })}><FileText size={19} /><span><strong>예시 상담 열기</strong><small>가상 대화 · 장비 사용 내역 확인</small></span><ArrowRight size={16} /></button>
        </>}
        <div className={css.explainer}><h3>상담이 지식이 되는 순간</h3><ol><li>원문에서 사실과 질문을 확인합니다.</li><li>말하지 않았던 판단 이유를 보완합니다.</li><li>다른 상황에도 통하는지 검토합니다.</li></ol></div>
      </section>
      <section className={css.sheet} aria-label="상담 가져오기"><h3 ref={importHeading} tabIndex={-1}>채팅·통화 전사문 가져오기</h3><p className={styles.hint}>현재는 텍스트만 가져옵니다. 통화 녹음과 음성 전사는 연결되지 않았습니다.</p>
        <label className={css.upload}><Upload size={17} />TXT·MD 파일 선택<input type="file" accept=".txt,.md,text/plain,text/markdown" onChange={(event) => { void upload(event.target.files?.[0]); }} /></label>
        <TextField label="상담 이름" value={input.title} onChange={(title) => setInput({ ...input, title })} short maxLength={100} required />
        <TextField label="화자가 구분된 전사문" value={input.transcript} onChange={(transcript) => { setInput({ ...input, transcript, permitted: false }); }} rows={9} maxLength={40000} hint="한 줄에 한 발화: [00:01] 고객: 내용 / [00:05] 전문가: 내용. AI 발화는 ‘AI:’로 구분합니다." required />
        <label className={css.check}><input type="checkbox" checked={permitted} onChange={(event) => setInput({ ...input, permitted: event.target.checked })} /><span>{live?.permissionLabel ?? "이 상담을 가르치기에 사용할 동의와 권한을 확인했습니다."}{input.kind === "sample" && " (가상 예시)"}</span></label>
        <button type="button" className={styles.primary} onClick={start}>원문으로 초안 만들기<ArrowRight size={16} /></button>
      </section>
    </div> : <>
      <div className={css.workbench}>
        <section className={css.transcript} aria-label="학습 근거 원문"><div className={css.sourceHeader}><h3 ref={sourceHeading} tabIndex={-1}>{draft.session.title}</h3><span className={css.meta}>{draft.session.kind === "sample" ? "가상 상담 예시" : draft.session.kind === "chat" ? "완료한 채팅" : "가져온 전사문"} · {draft.session.turns.length}개 발화</span></div>
          <ol>{draft.session.turns.map((turn) => <li key={turn.id} id={`turn-${turn.id}`} data-speaker={turn.speaker}><div><strong>{turn.authorName ?? (turn.speaker === "client" ? "고객" : turn.speaker === "expert" ? "전문가" : "AI")}</strong><span>{turn.at.includes("T") ? new Date(turn.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : turn.at}</span></div><p>{turn.text}</p></li>)}</ol>
          <p className={css.sourceFoot}>원문은 내 상담 근거로 보관합니다. 공통 지식에는 별도로 검토한 제안만 제출합니다.</p>
        </section>
        <section className={css.sheet} aria-label="상담에서 정리한 지식"><div className={css.draftHeader}><h3 ref={draftHeading} tabIndex={-1}>{demo ? "채워진 초안을 검토해 주세요" : "이 상담에서 무엇을 남길까요?"}</h3>{demo && !applied && <button type="button" className={styles.textButton} onClick={() => { verification.current?.scrollIntoView({ block: "start" }); verification.current?.focus({ preventScroll: true }); }}>다음: 적용 전 확인<ArrowRight size={16} /></button>}</div><p className={styles.hint}>{demo ? "선택한 고객 발화와 세무사 답변을 옮기고, 나머지 항목은 데모용 검토 예시로 채웠습니다. 내용을 수정하거나 적용 전 확인으로 이어가세요." : "화자별 발화를 옮긴 초안입니다. AI가 의미를 추론하지 않으며, 고객의 말은 확인된 사실과 구분해 검토해 주세요."}</p>
          <TextField label="지식 이름" value={draft.title} onChange={(title) => edit({ title })} short maxLength={100} required />
          <TextField label="사실 기반" value={draft.facts} onChange={(facts) => edit({ facts, evidenceConfirmed: false })} hint="왼쪽 고객 발화에서 가져왔습니다. 확인되지 않은 사실은 그대로 구분해 주세요." required />
          <TextField label="먼저 확인한 질문" value={draft.questions} onChange={(questions) => edit({ questions })} hint={demo ? "선택한 세무사 질문 또는 데모용 확인 질문입니다. 이 사례에 맞게 검토해 주세요." : "전문가가 질문한 발화를 한 줄씩 옮겼습니다."} />
          <TextField label="고객에게 전한 결론" value={draft.conclusion} onChange={(conclusion) => edit({ conclusion, evidenceConfirmed: false })} required />
          <div className={css.judgment}><h4>{demo ? "판단한 이유 검토" : "전문가에게만 알 수 있는 이유"}</h4><p>{demo ? "미리 채운 검토 예시가 세무사님의 판단과 맞는지 확인하고 수정해 주세요." : "어떤 사실이 판단을 바꿨나요? 원문에 없는 이유를 직접 알려주세요."}</p><TextField label="판단한 이유" value={draft.judgment} onChange={(judgment) => edit({ judgment })} required /></div>
          <TextField label="적용할 상황" value={draft.scope} onChange={(scope) => edit({ scope })} hint="이 지식을 다시 사용할 조건을 구체적으로 적어 주세요." required />
          <TextField label="답변이 달라지는 예외" value={draft.exceptions} onChange={(exceptions) => edit({ exceptions })} />
          <TextField label="검색어" value={draft.keywords} onChange={(keywords) => edit({ keywords })} short maxLength={500} hint="쉼표로 구분합니다. 예: 장비, 사용 내역" required />
          <label className={styles.field}>사용 범위<select value={draft.applicability} onChange={(event) => edit({ applicability: event.target.value as SessionLesson["applicability"] })}><option value="reusable">다른 상담에도 재사용</option><option value="session-only">이 상담에만 해당</option></select></label>
          <label ref={verification} tabIndex={-1} className={css.check}><input type="checkbox" checked={draft.evidenceConfirmed} onChange={(event) => edit({ evidenceConfirmed: event.target.checked })} /><span>원문과 비교해 사실, 화자, 결론을 확인했습니다.</span></label>
        </section>
      </div>
      <section className={css.rehearsal} aria-label="다른 상황 검토"><div><h3>한 가지가 달라져도 같은 판단일까요?</h3><p>다른 상황을 적고, 전문가가 기대하는 답변을 검토하세요. 여기서는 모델을 실행하지 않습니다.</p></div><div className={css.sheetFields}>
        <TextField label="다르게 시험할 상황" value={draft.scenario} onChange={(scenario) => edit({ scenario })} hint="예: 업무용으로만 사용했다면 무엇을 더 확인할까요?" />
        <TextField label="그 상황에서 기대하는 답변" value={draft.expected} onChange={(expected) => edit({ expected })} />
        <label className={css.check}><input type="checkbox" checked={draft.tested} disabled={!draft.scenario.trim() || !draft.expected.trim()} onChange={(event) => edit({ tested: event.target.checked })} /><span>다른 상황의 답변과 적용 범위를 검토했습니다.</span></label>
      </div></section>
      <div className={css.applyBar}><p>{applied ? "이 상담에서 배운 지식이 내 에이전트에 있습니다." : draft.applicability === "session-only" ? "이 상담에만 해당하는 내용은 재사용 지식으로 반영하지 않습니다." : "검토한 내용만 내 에이전트의 사례와 질문에 반영됩니다."}</p><div className={styles.actions}>
        {draft.applicability === "session-only" ? <button type="button" className={styles.secondary} onClick={async () => { const sessions = practice.learning?.sessions ?? []; if (sessions.length >= 20 && !sessions.some((s) => s.id === draft.session.id)) { setIssue("저장할 수 있는 상담 원문은 20개입니다."); return; } if (!await onApply({ ...practice, learning: { sessions: [...sessions.filter((s) => s.id !== draft.session.id), draft.session], draft } })) { setIssue("메모를 저장하지 못했습니다. 상단의 오류를 확인해 주세요."); return; } setNotice(live?.memoNotice ?? "상담 메모를 이 브라우저에 저장했습니다. 재사용 지식에는 추가하지 않았습니다."); }}>상담 메모로 보관</button> : <button type="button" className={styles.primary} disabled={saving} onClick={() => { void apply(); }}><Check size={16} />{applied ? "검토한 지식 업데이트" : "내 에이전트에 반영"}</button>}
        {applied && <><button type="button" className={styles.secondary} onClick={() => onKnowledge(draft.id)}>지식 모음 보기</button>{onContribute ? <button type="button" className={styles.textButton} onClick={() => onContribute(draft.id)}>공통 지식에 제안<ArrowRight size={16} /></button> : live?.afterApply && <span className={styles.hint}>{live.afterApply}</span>}</>}
      </div></div>
    </>}
  </>;
}
