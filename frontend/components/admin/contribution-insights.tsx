"use client";

import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { useContributionBoard } from "@/lib/contribution-store";
import { localKnowledgeCredits, summarizeCredits } from "@/lib/contribution-insights";
import { DemoLink, useDemo } from "@/components/demo/runtime";
import { Empty, SectionTitle } from "@/components/audit/agents/practice-ui";
import styles from "@/components/audit/agents/agent-practice.module.css";
import review from "@/components/audit/agents/knowledge-growth.module.css";
import css from "./contribution-insights.module.css";

export function ContributionInsights() {
  const demo = useDemo();
  const { board, error } = useContributionBoard();
  const [authorId, setAuthorId] = useState<string | null>(null);
  const stats = summarizeCredits(demo ? demo.run.credits : localKnowledgeCredits(board));
  const selected = stats.contributors.find(item => item.id === authorId);
  const events = stats.events.filter(item => !selected || item.authorId === selected.id);
  const accepted = stats.events.filter(item => item.amount > 0).length;
  return <section className={styles.studio}><div className={`${styles.content} ${review.reviewContent}`}>
    <SectionTitle title="지식을 나눈 사람들" description="공통 지식으로 이어진 기여와 크레딧의 분포를 한눈에 확인합니다." />
    <nav className={review.reviewNav} aria-label="공통 지식 운영"><DemoLink href="/admin/knowledge-contributions">제안 검토</DemoLink><DemoLink href="/admin/knowledge-contributions/insights" aria-current="page">크레딧 · 기여자 현황</DemoLink></nav>
    <p className={review.prototypeNote}>이 브라우저의 기여 기록 · 반영된 제출본당 1 cr · 실제 보상 지급을 의미하지 않습니다.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <dl className={css.metrics}><div><dt>누적 기여 크레딧</dt><dd>{stats.total}<small>cr</small></dd></div><div><dt>지식을 나눈 전문가</dt><dd>{stats.contributors.filter(item => item.amount > 0).length}<small>명</small></dd></div><div><dt>승인된 제출본</dt><dd>{accepted}<small>건</small></dd></div></dl>
    {stats.contributors.length ? <div className={css.overview}>
      <section className={css.chart} aria-labelledby="credit-distribution"><header><h2 id="credit-distribution">크레딧 분포</h2><p>철회를 반영한 누적 크레딧 기준</p></header><ul>{stats.contributors.map(item => <li key={item.id}><div><span>{item.name}</span><strong>{item.amount} cr <small>{Math.round(item.share * 100)}%</small></strong></div><div className={css.track} aria-hidden="true"><span style={{ width: `${item.share * 100}%` }} /></div></li>)}</ul>{stats.total === 0 && <p className={css.muted}>현재 유효한 기여 크레딧이 없습니다.</p>}</section>
      <section className={css.ranking} aria-labelledby="top-contributors"><header><h2 id="top-contributors">주요 기여자</h2><p>이름을 선택하면 아래에서 반영 내역을 볼 수 있어요.</p></header><ol>{stats.contributors.slice(0, 5).map((item, index) => <li key={item.id}><button type="button" aria-pressed={selected?.id === item.id} onClick={() => setAuthorId(selected?.id === item.id ? null : item.id)}><span className={css.rank}>{index + 1}</span><span><strong>{item.name}</strong><small>승인 {item.accepted}건{item.reversed > 0 ? ` · 철회 ${item.reversed}건` : ""}</small></span><b>{item.amount}<small>cr</small></b></button></li>)}</ol></section>
    </div> : <Empty title="첫 번째 기여를 기다리고 있어요">전문가의 제안을 승인하면 크레딧 분포와 기여자가 여기에 표시됩니다.<DemoLink className={styles.textButton} href="/admin/knowledge-contributions">검토할 제안 보기 →</DemoLink></Empty>}
    <section className={css.events} aria-labelledby="credit-history"><header><div><h2 id="credit-history">{selected ? `${selected.name}의 반영 내역` : "전체 반영 내역"}</h2><p>제안, 작성자, 크레딧을 함께 확인합니다.</p></div>{selected && <button type="button" onClick={() => setAuthorId(null)}>전체 보기</button>}</header>
      {events.length ? <ul>{events.map(item => { const entry = board.entries.find(value => value.id === item.contributionId); return <li key={item.id}><div><DemoLink href={`/admin/knowledge-contributions?contribution=${encodeURIComponent(item.contributionId)}`}>{entry?.payload.title ?? "공유 지식"}<ArrowUpRight size={14} aria-hidden="true" /></DemoLink><p>{item.author} · 제출본 {item.revision} · {new Date(item.at).toLocaleDateString("ko-KR")}</p></div><strong data-reversed={item.amount < 0}>{item.amount > 0 ? "+" : ""}{item.amount} cr<small>{item.amount > 0 ? "승인 반영" : "반영 철회"}</small></strong></li>; })}</ul> : <p className={css.muted}>아직 반영 내역이 없습니다.</p>}
    </section>
  </div></section>;
}
