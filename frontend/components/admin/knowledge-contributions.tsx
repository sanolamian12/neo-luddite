"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useContributionBoard } from "@/lib/contribution-store";
import { useAccountStore } from "@/lib/account-store";
import { contributionStatus } from "@/lib/knowledge-contributions";
import { ContributionDetail } from "@/components/audit/agents/contribution-detail";
import { Empty, SectionTitle } from "@/components/audit/agents/practice-ui";
import styles from "@/components/audit/agents/agent-practice.module.css";
import css from "@/components/audit/agents/knowledge-growth.module.css";

export function KnowledgeContributionReview() {
  const { board, transact, error } = useContributionBoard();
  const admin = useAccountStore((state) => state.admin);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("pending");
  const detail = useRef<HTMLDivElement>(null);
  const submitted = board.entries.filter((entry) => entry.revisions.length > 0);
  const selected = submitted.find((entry) => entry.id === selectedId);
  useEffect(() => { if (selectedId && window.matchMedia("(max-width: 800px)").matches) { detail.current?.scrollIntoView({ block: "start" }); detail.current?.focus({ preventScroll: true }); } }, [selectedId]);
  return <section className={styles.studio}><div className={styles.content}>
    <SectionTitle title="공통 지식 기여 검토" description="전문가의 제안을 검토하고, 반영된 지식과 작성자의 기여를 연결합니다." />
    <p className={css.prototypeNote}>이 브라우저의 제출·검토 시연입니다. 반영은 로컬 기록에만 적용되며 실제 KB 배포나 보상 지급은 실행되지 않습니다.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={css.ledger} data-detail={!!selected}>
      <section className={css.ledgerList} aria-label="제출된 기여 목록"><div className={css.listTools}><h3>검토할 제안</h3><select aria-label="검토 상태 필터" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">전체 제출</option>{Object.entries(contributionStatus).filter(([value]) => value !== "draft").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        {submitted.filter((entry) => filter === "all" || entry.status === filter).reverse().map((entry) => <button type="button" key={entry.id} className={css.proposalRow} aria-pressed={selectedId === entry.id} onClick={() => setSelectedId(entry.id)}><span className={css.status} data-status={entry.status}>{contributionStatus[entry.status]}</span><strong>{entry.payload.title}</strong><small>{entry.author.name} · 제출본 {entry.revisions.length}</small></button>)}
        {!submitted.some((entry) => filter === "all" || entry.status === filter) && <Empty title="이 상태의 제안이 없습니다">전문가가 제출한 제안이 이곳에 모입니다.</Empty>}
      </section>
      <div ref={detail} tabIndex={-1} className={css.ledgerDetail}><button type="button" className={`${styles.textButton} ${css.mobileBack}`} onClick={() => setSelectedId(null)}><ArrowLeft size={16} />검토 목록으로</button>{selected ? <ContributionDetail key={selected.id} entry={selected} actor={{ id: admin.id, name: admin.operatorName, role: "reviewer" }} transact={transact} /> : <Empty title="제안을 선택해 주세요">근거, 적용 범위, 개인정보와 중복 여부를 확인한 뒤 검토 결과를 남깁니다.</Empty>}</div>
    </div>
  </div></section>;
}
