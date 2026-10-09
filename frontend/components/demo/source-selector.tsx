"use client";
import { useState } from "react";
import { proposeLesson } from "@/lib/session-learning";
import { teachingSource } from "@/lib/demo/domain";
import { DemoLink, useDemo } from "./runtime";
import { SectionTitle } from "@/components/audit/agents/practice-ui";
import styles from "@/components/audit/agents/agent-practice.module.css";
import css from "./demo.module.css";
export function DemoSourceSelector() {
  const demo = useDemo()!; const { run, act } = demo; const [issue, setIssue] = useState("");
  const selection = run.selection;
  const messages = run.messages.filter((message) => message.author !== "system");
  const count = selection.mode === "all" ? messages.length : messages.filter((message) => selection.ids.includes(message.id)).length;
  function change(patch: Partial<typeof selection>) { act((old) => ({ ...old, selection: { ...old.selection, ...patch, permitted: false } })); }
  function create() {
    if (!selection.permitted) { setIssue("이 상담을 가르치기에 사용할 권한을 확인해 주세요."); return; }
    if (run.agent.practice.learning?.draft && !window.confirm("기존 검토 초안을 선택한 대화로 다시 만들까요? 직접 적은 판단은 새 초안에 포함되지 않습니다.")) return;
    try { demo.transact((old) => ({ ...old, scene: "B3", beforePractice: old.agent.practice, agent: { ...old.agent, practice: { ...old.agent.practice, learning: { sessions: old.agent.practice.learning?.sessions ?? [], draft: proposeLesson(teachingSource(old, old.selection.mode, old.selection.ids)) } } } })); setIssue(""); }
    catch (cause) { setIssue(cause instanceof Error ? cause.message : "선택한 내용을 확인해 주세요."); }
  }
  return <section>
    <SectionTitle title="어떤 상담에서 배울까요?" description="상담을 불러온 뒤 전체 대화 또는 남길 부분을 선택합니다." />
    {!run.completed ? <p>아직 상담이 완료되지 않았습니다. <DemoLink href="/audit/consultations?kind=participation">세무사 답변을 남기고 상담 완료하기</DemoLink></p> : <>
      <button className={styles.knowledgeRow} onClick={() => change({ opened: true })}><span><strong>장비의 업무·개인 사용 상담</strong><span className={styles.rowMeta}>{run.agent.name.replace("의 AI", "")} · 고객 · {messages.length}개 발화 · 완료한 상담</span></span><span>이 상담 불러오기</span></button>
      {selection.opened && <>
        <div className={css.scope} role="group" aria-label="가르칠 대화 범위"><button aria-pressed={selection.mode === "all"} onClick={() => change({ mode: "all" })}>전체 상담</button><button aria-pressed={selection.mode === "selected"} onClick={() => change({ mode: "selected" })}>일부 선택</button><strong aria-live="polite">{count}개 발화 선택됨</strong></div>
        <div className={css.selectList}>{messages.map((message) => { const selected = selection.mode === "all" || selection.ids.includes(message.id); return <label key={message.id} className={css.selectRow} data-selected={selected}><input type="checkbox" aria-label={`${message.name}: ${message.text.slice(0, 24)}`} checked={selected} disabled={selection.mode === "all"} onChange={() => change({ ids: selected ? selection.ids.filter((id) => id !== message.id) : [...selection.ids, message.id] })} /><div><strong>{message.name}</strong><p>{message.text}</p></div></label>; })}</div>
        <p className={css.note}>선택한 대화만 초안에 들어갑니다. 고객의 사실과 세무사의 직접 답변을 함께 선택해 주세요.</p>
        <label className={styles.field}><span><input type="checkbox" checked={selection.permitted} onChange={(event) => act((old) => ({ ...old, selection: { ...old.selection, permitted: event.target.checked } }))} /> 이 가상 상담을 가르치기에 사용할 권한을 확인했습니다.</span></label>
        {issue && <p role="alert" className={styles.error}>{issue}</p>}
        <button className={styles.primary} disabled={!count} onClick={create}>선택한 대화로 초안 만들기</button>
      </>}
    </>}
  </section>;
}
