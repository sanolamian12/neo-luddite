"use client";
import Link from "next/link";
import { useDemo } from "@/components/demo/runtime";
import { DemoConversation } from "@/components/demo/conversation";
import { useRouter, useSearchParams } from "next/navigation";
import { Save } from "lucide-react";
import { ExpertConsultationsView } from "@/components/consultation/expert-consultations-view";
import { agentHref } from "@/lib/agent-navigation";
import { LibraryFeedback, MissingAgent, useAgentLibrary } from "./agent-library";
import { PracticeInbox } from "./practice-rehearsal";
import styles from "./agent-practice.module.css";

export function ConsultationHub({ initialId }: { initialId?: string }) {
  const demo = useDemo();
  const library = useAgentLibrary();
  const { agent, agents, dirty, locked } = library;
  const search = useSearchParams(), router = useRouter();
  const participation = search.get("kind") === "participation" && !initialId;
  const pending = agents.reduce((sum, item) => sum + item.practice.reviews.filter((review) => review.status !== "resolved").length, 0);
  if (demo) return <DemoConversation expertView />;
  return <section className={styles.studio}>
    <header className={styles.toolbar}><div className={styles.identity}><div><h1>상담 요청</h1><span>새로운 상담과 AI 대화의 직접 참여 요청</span></div></div>{participation && <button type="button" className={styles.primary} disabled={locked} onClick={library.save}><Save size={16} />{dirty ? "변경 저장" : "요청함 저장"}</button>}</header>
    <nav className={styles.requestTabs} aria-label="상담 요청 유형"><Link href={`/audit/consultations?kind=new${agent ? `&agent=${encodeURIComponent(agent.id)}` : ""}`} aria-current={!participation ? "page" : undefined}>새 상담 신청</Link><Link href={agentHref("inbox", agent?.id)} aria-current={participation ? "page" : undefined}>직접 참여 요청 {pending > 0 && `(${pending})`}</Link></nav>
    {participation ? <><LibraryFeedback /><div className={styles.agentBar}><label className={styles.field}>참여 요청을 볼 에이전트<select value={agent?.id ?? ""} onChange={(event) => { const query = new URLSearchParams(search.toString()); query.set("agent", event.target.value); query.delete("review"); router.push(`/audit/consultations?${query}`); }}>{!agent && <option value="">선택해 주세요</option>}{agents.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.practice.reviews.filter((review) => review.status !== "resolved").length}개</option>)}</select></label><Link className={styles.textButton} href={agentHref("preview", agent?.id)}>미리보기로 돌아가기</Link></div>{agent ? <div className={styles.content}><PracticeInbox key={agent.id} practice={agent.practice} onChange={(practice) => library.update({ ...agent, practice })} selectedId={search.get("review")} onSelect={(id) => router.push(`${agentHref("inbox", agent.id)}&review=${encodeURIComponent(id)}`, { scroll: false })} onPreview={() => router.push(agentHref("preview", agent.id))} /></div> : <MissingAgent />}</> : <ExpertConsultationsView key={initialId ?? "list"} initialId={initialId} />}
  </section>;
}
