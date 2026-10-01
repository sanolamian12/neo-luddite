"use client";
import Link from "next/link";
import { ArrowRight, Bot, Inbox, MessageCircle, UserRound } from "lucide-react";
import { useConsultationHydrated, useConsultationStore } from "@/lib/consultation-store";
import { agentHref } from "@/lib/agent-navigation";
import { useAgentLibrary } from "./agent-library";
import styles from "./agent-practice.module.css";

export function ExpertDashboard() {
  const { owner, expertName, agents, agent, dirty } = useAgentLibrary();
  const requests = useConsultationStore((state) => state.requests);
  const hydrated = useConsultationHydrated();
  const mine = requests.filter((item) => item.expertId === owner);
  const pending = mine.filter((item) => item.status === "pending");
  const active = mine.filter((item) => item.status === "accepted");
  const reviews = agents.flatMap((item) => item.practice.reviews.filter((review) => review.status !== "resolved").map((review) => ({ agent: item, review })));
  const waiting = reviews.filter((item) => item.review.status === "waiting");
  const waitingHref = waiting[0] ? `${agentHref("inbox", waiting[0].agent.id)}&review=${encodeURIComponent(waiting[0].review.id)}` : agentHref("inbox", agent?.id);
  return <section className={styles.studio}><div className={styles.dashboardScroll}>
    <header className={styles.dashboardTitle}><h1>{expertName}님,<br />오늘 확인할 상담입니다.</h1><p>AI가 진행하는 상담을 살피고, 내 판단이 필요한 순간에 함께하세요.</p><p className={styles.hint}>프로토타입 · 이 브라우저의 예시 상담을 표시합니다.</p></header>
    <div className={styles.dashboardGrid}>
      <section className={styles.workQueue} aria-label="상담 현황"><h2>나의 상담</h2>
        {[{ title: "새 상담 신청", count: hydrated ? pending.length : "…", body: "고객이 새로 상담을 신청했습니다", href: "/audit/consultations?kind=new", icon: Inbox }, { title: "직접 참여 요청", count: waiting.length, body: "AI 대화의 맥락과 판단 이유를 확인하세요 · 미리보기", href: waitingHref, icon: UserRound }, { title: "진행 중인 상담", count: hydrated ? active.length : "…", body: "수락한 상담의 진행 상황을 살펴보세요", href: "/audit/consultations?kind=new", icon: MessageCircle }].map(({ title, count, body, href, icon: Icon }) => <Link className={styles.workRow} href={href} key={title}><Icon size={23} strokeWidth={1.5} /><span><strong>{title}</strong><small>{body}</small></span><b>{count}</b><ArrowRight size={17} /></Link>)}
        <p className={styles.hint}>예약 일시는 아직 연결되지 않았습니다. 수락한 상담을 진행 중으로 표시합니다.</p>
      </section>
      <aside className={styles.agentSummary}><Bot size={28} strokeWidth={1.5} /><span className={styles.hint}>내 에이전트 {agents.length}개</span><h2>{agent?.name || "에이전트를 선택해 주세요"}</h2>{agent && <><p>{agent.practice.introduction}</p><dl><div><dt>직접 가르친 사례</dt><dd>{agent.practice.cases.filter((item) => item.origin === "expert").length}개</dd></div><div><dt>사용 중인 상담 기준</dt><dd>{agent.practice.rules?.filter((item) => item.enabled).length ?? 0}개</dd></div><div><dt>직접 참여 상태</dt><dd>{agent.practice.policy.available ? "참여 가능" : "부재중"}</dd></div></dl><Link className={styles.primary} href={agentHref("overview", agent.id)}>내 에이전트 살펴보기<ArrowRight size={16} /></Link></>}{dirty && <p className={styles.hint}>저장하지 않은 에이전트 변경이 있습니다.</p>}</aside>
    </div>
    <section className={styles.dashboardRequests}><div className={styles.panelHead}><h2>내 판단을 기다리는 대화</h2><Link className={styles.textButton} href={agentHref("inbox", agent?.id)}>참여 요청 전체<ArrowRight size={14} /></Link></div>{reviews.length ? reviews.slice(0, 5).map(({ agent: item, review }) => <Link className={styles.knowledgeRow} href={`${agentHref("inbox", item.id)}&review=${encodeURIComponent(review.id)}`} key={`${item.id}-${review.id}`}><span><span className={styles.provenance}>{item.name} · {review.status === "human" ? "직접 참여 중" : "참여 대기"}</span><strong>{review.title}</strong><span className={styles.rowMeta}>{review.reason}</span></span><ArrowRight size={16} /></Link>) : <p className={styles.introCopy}>지금은 직접 참여할 대화가 없습니다. 미리보기에서 고객 여정과 참여 요청을 시험할 수 있습니다.</p>}</section>
  </div></section>;
}
