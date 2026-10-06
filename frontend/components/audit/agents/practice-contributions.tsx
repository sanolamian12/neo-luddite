"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Plus, Users } from "lucide-react";
import { useContributionBoard } from "@/lib/contribution-store";
import { contributionKind, contributionStatus, contributionSummary, createContribution, emptyPayload } from "@/lib/knowledge-contributions";
import { knowledgeHref } from "@/lib/agent-navigation";
import { useAgentLibrary } from "./agent-library";
import { ContributionDetail } from "./contribution-detail";
import { Empty, SectionTitle } from "./practice-ui";
import styles from "./agent-practice.module.css";
import css from "./knowledge-growth.module.css";

export function PracticeContributions() {
  const { owner, expertName, agent, agents, contributionEdits, setContributionEdit } = useAgentLibrary();
  const { board, transact, error } = useContributionBoard();
  const search = useSearchParams(), router = useRouter();
  const [issue, setIssue] = useState("");
  const filter = search.get("filter") ?? "all";
  function setFilter(value: string) { const query = new URLSearchParams(search.toString()); query.set("filter", value); query.delete("contribution"); router.push(`/audit/contributions?${query}`, { scroll: false }); }
  const detail = useRef<HTMLDivElement>(null);
  const mine = board.entries.filter((entry) => entry.author.id === owner);
  const selected = mine.find((entry) => entry.id === search.get("contribution"));
  const selectedId = selected?.id;
  const sourceCase = agent?.practice.cases.find((entry) => entry.id === search.get("case") && entry.origin === "expert");
  const sourceQuestion = agent?.practice.questions.find((entry) => entry.id === search.get("question") && entry.origin === "expert");
  const actor = { id: owner, name: expertName, role: "expert" as const };
  const summary = contributionSummary(board, owner);
  function select(id?: string) { const query = new URLSearchParams(); if (agent) query.set("agent", agent.id); if (filter !== "all") query.set("filter", filter); if (id) query.set("contribution", id); router.push(`/audit/contributions${query.size ? `?${query}` : ""}`, { scroll: false }); }
  useEffect(() => { if (!selectedId) return; const frame = requestAnimationFrame(() => { detail.current?.scrollIntoView({ block: "start" }); detail.current?.focus({ preventScroll: true }); }); return () => cancelAnimationFrame(frame); }, [selectedId]);
  function create(fromSource = false) {
    const originatingAgent = fromSource ? agent : agent ?? agents[0];
    if (!originatingAgent) return;
    const sourceId = fromSource ? sourceCase?.id ?? sourceQuestion?.id ?? crypto.randomUUID() : crypto.randomUUID();
    const existing = mine.find((entry) => entry.sourceId === sourceId);
    if (existing) { select(existing.id); return; }
    const payload = fromSource && sourceCase ? { ...emptyPayload(), title: sourceCase.title, facts: sourceCase.facts, judgment: sourceCase.judgment, conclusion: sourceCase.conclusion, exceptions: sourceCase.exceptions, keywords: sourceCase.keywords, scope: sourceCase.scope ?? "", questions: originatingAgent.practice.questions.filter((question) => question.caseId === sourceCase.id).map((question) => question.prompt).join("\n") } : fromSource && sourceQuestion ? { ...emptyPayload(), kind: "question" as const, title: sourceQuestion.prompt.slice(0, 100), questions: sourceQuestion.prompt } : emptyPayload();
    try {
      const next = transact((current) => createContribution(current, { agentId: originatingAgent.id, sourceId, payload }, actor));
      select(next.entries.at(-1)!.id); setIssue("");
    } catch (error) { setIssue(error instanceof Error ? error.message : "초안을 저장하지 못했습니다."); }
  }
  const sourceAgent = selected ? agents.find((item) => item.id === selected.agentId) : agent;
  const sourceId = selected?.sourceId ?? sourceCase?.id ?? sourceQuestion?.id;
  const sourceKind = sourceAgent?.practice.questions.some((item) => item.id === sourceId) ? "question" : "case";
  const sourceExists = sourceAgent && sourceId && [...sourceAgent.practice.cases, ...sourceAgent.practice.questions].some((item) => item.id === sourceId);
  const preparing = !!(sourceCase || sourceQuestion) && !selected;
  const missing = !!(search.get("case") || search.get("question")) && !preparing && !selected;
  const returnLinks = <nav className={css.returnLinks} aria-label="기여 돌아가기"><button type="button" className={styles.textButton} onClick={() => select()}><ArrowLeft size={16} />내 제안 목록</button>{sourceExists && <Link className={styles.textButton} href={knowledgeHref(sourceAgent.id, sourceKind, sourceId)}>원래 {sourceKind === "question" ? "질문" : "사례"}로 돌아가기<ArrowRight size={16} /></Link>}</nav>;
  return <>
    <SectionTitle title={preparing ? "공유 제안 준비" : "함께 만드는 공통 지식"} description="나의 경험이 다른 전문가의 에이전트에도 도움이 되도록. 제안부터 반영, 기여 인정까지 이어집니다." action={<button type="button" className={styles.primary} disabled={!!error} onClick={() => create()}><Plus size={16} />새 지식 제안</button>} />
    {!selected && <><div className={css.collective}><Users size={26} strokeWidth={1.5} /><div><strong>기여는 작성자의 이름으로 남습니다.</strong><p>내 모든 에이전트의 제안을 함께 봅니다. 검토 후 반영된 지식에 기여 기록을 연결하고, 향후 보상 심사의 근거로 남깁니다.</p></div></div>
    <div className={css.summary} aria-label="내 기여 현황"><span>내 제안 <strong>{summary.total}</strong></span><span>검토 중 <strong>{summary.pending}</strong></span><span>반영됨 <strong>{summary.published}</strong></span><span>보상 검토 대상 <strong>{summary.eligible}</strong></span></div>
    <p className={css.prototypeNote}>브라우저 내 시연 · 실제 공통 KB 배포나 모델 학습, 보상 지급은 실행되지 않습니다. 지급 기준과 금액은 미정입니다.</p></>}
    {(error || issue) && <p className={styles.error} role="alert">{error || issue}</p>}
    {missing && <p role="alert" className={styles.error}>원래 지식을 찾을 수 없습니다. 내 지식 모음에서 다시 선택하거나 새 제안을 시작하세요.</p>}
    {search.get("contribution") && !selected && !error && <p role="alert" className={styles.error}>이 계정의 기여 내역을 찾을 수 없습니다. 아래 목록에서 다시 선택하세요.</p>}
    {preparing && returnLinks}
    {preparing && <section className={css.gateway}><div><h3>{sourceCase?.title ?? sourceQuestion?.prompt}</h3><p>내 지식에서 가져와 공유용 사본을 만듭니다. 개인정보와 근거를 확인한 뒤 별도로 제출하세요.</p></div><button type="button" className={styles.primary} disabled={!!error} onClick={() => create(true)}>이 지식으로 공유 초안 만들기<ArrowRight size={16} /></button></section>}
    <div className={css.ledger} data-detail={!!selected}>
      <section className={css.ledgerList} aria-label="내 기여 목록"><div className={css.listTools}><h3>내 기여 내역</h3><select aria-label="기여 상태 필터" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">전체 상태</option>{Object.entries(contributionStatus).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        {mine.filter((entry) => filter === "all" || entry.status === filter).reverse().map((entry) => <button type="button" key={entry.id} className={css.proposalRow} aria-pressed={selected?.id === entry.id} onClick={() => select(entry.id)}><span className={css.status} data-status={entry.status}>{contributionStatus[entry.status]}</span><strong>{contributionEdits[entry.id]?.payload.title || entry.payload.title || "새 지식 제안"}</strong>{contributionEdits[entry.id] && <small>자동 저장 실패 · 입력 보관 중</small>}<small>{contributionKind[entry.payload.kind]} · {entry.author.name}{entry.credit?.status === "eligible" ? " · 기여 인정" : ""}</small><ArrowRight size={16} /></button>)}
        {!mine.some((entry) => filter === "all" || entry.status === filter) && <Empty title={mine.length ? "이 상태의 제안이 없습니다" : "첫 번째 지식을 나눠 주세요"}>{mine.length ? "다른 상태를 선택해 보세요." : "지식 모음에서 사례를 가져오거나, 새 지식을 직접 제안할 수 있습니다."}</Empty>}
      </section>
      <div ref={detail} tabIndex={-1} className={css.ledgerDetail}>{selected && returnLinks}{selected ? <ContributionDetail key={selected.id} entry={selected} actor={actor} transact={transact} workingCopy={contributionEdits[selected.id]} onWorkingCopy={(copy) => setContributionEdit(selected.id, copy)} /> : <div className={css.howItWorks}><h3>함께 개선하고, 기여를 남깁니다.</h3><ol><li><strong>지식 제안</strong><p>확인 질문, 답변 사례, 잘못된 지식의 정정을 제안하세요.</p></li><li><strong>근거와 적용 범위 검토</strong><p>검토 의견을 받고 같은 제안을 보완할 수 있습니다.</p></li><li><strong>공통 지식 반영과 기여 인정</strong><p>반영 버전과 작성자를 연결합니다. 철회 내역도 기록에 남습니다.</p></li></ol><p className={styles.hint}>제안 횟수만으로 보상하지 않습니다. 검토된 기여와 품질을 기준으로 보상 정책을 정할 예정입니다.</p></div>}</div>
    </div>
  </>;
}
