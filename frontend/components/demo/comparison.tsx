"use client";
import { useState } from "react";
import { retrieveCases } from "@/lib/agent-practice";
import { script } from "@/lib/demo/domain";
import { DemoLink, useDemo } from "./runtime";
import { SectionTitle } from "@/components/audit/agents/practice-ui";
import styles from "@/components/audit/agents/agent-practice.module.css";
import css from "./demo.module.css";
export function DemoComparison() {
  const { run } = useDemo()!; const [query, setQuery] = useState(script.probe); const [asked, setAsked] = useState("");
  const before = retrieveCases(run.beforePractice, asked)[0];
  const after = retrieveCases(run.agent.practice, asked)[0];
  return <><SectionTitle title="가르치기 전과 후, 같은 질문으로" description="저장한 지식이 질문과 답변에 어떻게 반영되는지 비교합니다. 로컬 키워드 기반 시연입니다." />
    <label className={styles.field}>시험할 질문<textarea value={query} onChange={(event) => setQuery(event.target.value)} /></label><button className={styles.primary} onClick={() => setAsked(query)} disabled={!query.trim()}>같은 질문으로 비교하기</button>
    {asked && <div className={css.compare}>{[{ title: "가르치기 전", entry: before, practice: run.beforePractice }, { title: "가르친 후", entry: after, practice: run.agent.practice }].map(({ title, entry, practice }) => <section key={title}><h3>{title}</h3><p>{entry?.conclusion ?? "업무와 개인 사용 목적, 구입 증빙을 먼저 알려 주세요."}</p>{entry && <><details className={css.source}><summary>참고한 지식 · {entry.title}</summary><p>{entry.judgment}</p></details><p>{practice.questions.filter((item) => item.enabled && item.caseId === entry.id).map((item) => item.prompt).join("\n")}</p></>}</section>)}</div>}
    <div className={styles.actions}><DemoLink className={styles.secondary} href="/audit/agents/knowledge">지식 모음에서 공유할 내용 선택</DemoLink></div>
  </>;
}
