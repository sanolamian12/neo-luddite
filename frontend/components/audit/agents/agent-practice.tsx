"use client";
import { useDemoRouter as useRouter, useDemo } from "@/components/demo/runtime";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { ArrowRight, BookOpen, Bot, Check, ChevronRight, Copy, FileQuestion, GraduationCap, MessageCircle, Plus, Save, ShieldCheck, UserRound } from "lucide-react";
import { blankLesson, type Practice } from "@/lib/agent-practice";
import { agentHref, teachingHref, knowledgeHref, taskFromPath, type AgentTask } from "@/lib/agent-navigation";
import { LibraryFeedback, MissingAgent, useAgentLibrary, type PracticeAgent } from "./agent-library";
import { PracticeRules } from "./practice-rules";
import { PracticeTeaching } from "./practice-teaching";
import { PracticeKnowledge } from "./practice-knowledge";
import { AgentTaskNavigation } from "./agent-task-navigation";
import { initialPreview, PracticeRehearsal } from "./practice-rehearsal";
import { Provenance, SectionTitle, TextField, Toggle } from "./practice-ui";
import { DemoComparison } from "@/components/demo/comparison";
import { AgentAvatar } from "@/components/demo/avatars";
import styles from "./agent-practice.module.css";
import { expertServerSync, RealPreview } from "./expert-server";
import { LivePracticeTeaching } from "./live-practice-teaching";
import { LivePracticeKnowledge } from "./live-practice-knowledge";

type View = AgentTask;

export function AgentPractice({ children }: { children?: ReactNode }) {
  const demo = useDemo();
  const library = useAgentLibrary();
  const path = usePathname();
  const { agent, agents, expertName, select, add, save, locked, dirty, persisted } = library;
  if (!taskFromPath(path) || taskFromPath(path) === "advanced") return children;
  if (!agent) return <MissingAgent />;
  return <section className={styles.studio} aria-label="전문가 에이전트 워크스페이스">
    <header className={styles.toolbar}><div className={styles.identity}>{demo ? <AgentAvatar expertId={demo.run.expertId} /> : <div className={styles.agentMark}><Bot size={25} strokeWidth={1.6} /></div>}<div><h1>내 에이전트</h1><span>{expertName} 전문가의 상담 기준</span></div></div><div className={styles.actions}><span className={styles.saveState} aria-live="polite">{dirty ? "저장하지 않은 변경" : persisted ? expertServerSync ? "서버에 저장됨" : "브라우저에 저장됨" : "예시로 시작한 초안"}</span><button type="button" className={styles.primary} disabled={locked} onClick={save}><Save size={16} />변경 저장</button></div></header>
    <div className={styles.agentBar}><label><span className={styles.srOnly}>에이전트 선택</span><select aria-label="에이전트 선택" value={agent.id} onChange={(event) => select(event.target.value)}>{agents.map((item) => <option value={item.id} key={item.id}>{item.name || "이름 없는 에이전트"}</option>)}</select></label>{!demo && <details className={styles.agentManagement}><summary>에이전트 관리</summary><div><button type="button" className={styles.textButton} disabled={agents.length >= 30} onClick={() => add()}><Plus size={15} />새 에이전트</button><button type="button" className={styles.textButton} disabled={agents.length >= 30} onClick={() => add(true)}><Copy size={14} />복제</button></div></details>}{expertServerSync && <label className={styles.serverChoice}><input type="checkbox" checked={(library.roomAgentId ?? agents[0]?.id) === agent.id} onChange={() => library.setRoomAgent(agent.id)} />연결 상담방에서 쓰는 에이전트</label>}<span className={styles.localLabel}>{expertServerSync ? "서버 저장 · 게시한 사례를 AI가 참고" : "프로토타입 · 이 브라우저에만 저장"}</span></div>
    <LibraryFeedback />
    <Workspace key={agent.id} agent={agent} expertName={expertName} onChange={library.update} />
    {children}
  </section>;
}

function Workspace({ agent, expertName, onChange }: { agent: PracticeAgent; expertName: string; onChange: (agent: PracticeAgent) => void }) {
  const demo = useDemo();
  const router = useRouter();
  const view = taskFromPath(usePathname()) ?? "overview";
  const { preview, setPreview, commit } = useAgentLibrary();
  function setView(next: View) { router.push(agentHref(next, agent.id), { scroll: false }); }
  const content = useRef<HTMLDivElement>(null);
  const practice = agent.practice;
  const pending = practice.reviews.filter((review) => review.status !== "resolved");
  function change(next: Practice) { onChange({ ...agent, practice: next }); }
  function teach(method: "session" | "manual" = "manual") { if (method === "manual" && practice.lesson.step === 3) change({ ...practice, lesson: blankLesson() }); router.push(teachingHref(agent.id, method), { scroll: false }); }
  function knowledge(kind: "case" | "question" = "case", id?: string) { router.push(knowledgeHref(agent.id, kind, id), { scroll: false }); }
  function test(query?: string) { setPreview({ ...initialPreview(), phase: query ? 2 : preview.phase, query: query || preview.query }); setView("preview"); }
  function contribute(id?: string, type: "case" | "question" = "case") { router.push(`${agentHref("contributions", agent.id)}${id ? `&${type}=${encodeURIComponent(id)}` : ""}`, { scroll: false }); }
  useEffect(() => { content.current?.scrollTo({ top: 0 }); content.current?.querySelector<HTMLElement>("[data-task-heading]")?.focus({ preventScroll: true }); }, [view]);
  return <>
    <AgentTaskNavigation agentId={agent.id} />
    <div className={styles.content} ref={content} data-agent-content>
      {view === "overview" && <>
        <div className={styles.overviewHero}><div className={styles.invitation}><h2 tabIndex={-1} data-task-heading>나의 판단을,<br />AI의 기준으로.</h2><p>어떤 사실을 확인하고, 어떻게 답하고,<br className={styles.desktopBreak} /> 언제 내가 함께할지. 나다운 상담을 가르쳐 주세요.</p><div className={styles.actions}>{!expertServerSync && <button type="button" className={styles.primary} onClick={() => teach("session")}><GraduationCap size={18} />{practice.learning?.draft || practice.learning?.intake?.transcript ? "상담 검토 이어가기" : "상담에서 배우기"}<ArrowRight size={17} /></button>}<button type="button" className={expertServerSync ? styles.primary : styles.secondary} onClick={() => teach("manual")}>{practice.lesson.title && practice.lesson.step < 3 ? "사례 작성 이어가기" : "사례 직접 입력"}</button></div><span className={styles.hint}>{expertServerSync ? "익숙한 사례를 직접 들려주세요. 검토한 사례를 서버에 보관할 수 있습니다." : "완료한 상담을 가져오거나, 익숙한 사례를 직접 들려주세요."}</span></div>
          <div className={styles.roleMap} aria-label="에이전트의 세 가지 역할"><div className={styles.roleMapHeader}><span>나의 기준으로 이어지는 상담</span><span className={styles.liveDot} aria-hidden="true" /></div>{[{ icon: FileQuestion, title: "먼저 이해하고", body: "질문으로 사실을 확인합니다", foot: `${practice.questions.filter((item) => item.enabled && item.origin === "expert").length}개의 확인 질문`, target: "knowledge" }, { icon: BookOpen, title: "근거를 담아 답하고", body: "나의 사례와 판단을 참고합니다", foot: `${practice.cases.filter((item) => item.enabled && item.origin === "expert").length}개의 사용 중인 사례`, target: "knowledge" }, { icon: UserRound, title: "필요한 순간, 나와 함께", body: "직접 참여할 때를 알아봅니다", foot: "내가 정한 참여 기준", target: "principles" }].map(({ icon: Icon, title, body, foot, target }, index) => <button type="button" key={title} aria-label={`${title}: ${foot}`} className={styles.roleStep} onClick={() => target === "knowledge" ? knowledge(index === 0 ? "question" : "case") : setView(target as View)}><span className={styles.roleIcon} data-tone={index}><Icon size={21} strokeWidth={1.6} /></span><span><strong>{title}</strong><span>{body}</span></span><small>{foot}<ChevronRight size={13} /></small></button>)}</div>
        </div>
        <div className={styles.overviewBottom}><section className={styles.overviewKnowledge}><div className={styles.panelHead}><h3>에이전트에 담긴 지식</h3><button type="button" className={styles.textButton} onClick={() => setView("knowledge")}>모두 보기<ArrowRight size={14} /></button></div>{!practice.cases.some((item) => item.origin === "expert") && <p className={styles.introCopy}>아직 직접 가르친 지식이 없습니다. 사례 하나로 시작해 보세요. 공통 지식은 플랫폼에서 관리합니다.</p>}{practice.cases.filter((item) => item.origin === "expert").slice(-3).reverse().map((entry) => <button type="button" className={styles.knowledgeRow} key={entry.id} onClick={() => knowledge("case", entry.id)}><span><Provenance sample={entry.origin === "sample"} /><strong>{entry.title}</strong><span className={styles.rowMeta}>사실 · 판단 · 결론{entry.exceptions ? " · 예외" : ""}</span></span><ArrowRight size={16} /></button>)}</section><section className={styles.attention}><div className={styles.panelHead}><h3>내가 함께할 순간</h3><MessageCircle size={20} strokeWidth={1.5} /></div>{pending.length ? <><strong className={styles.attentionTitle}>{pending.length}개의 대화가 기다립니다</strong><p>{pending[0].reason}</p><button type="button" className={styles.secondary} onClick={() => { router.push(`${agentHref("inbox", agent.id)}&review=${encodeURIComponent(pending[0].id)}`); }}>대화 살펴보기<ArrowRight size={15} /></button></> : <><strong className={styles.attentionTitle}>참여할 대화가 생기면,<br />맥락과 함께 알려드립니다.</strong><p>고객 여정을 시험하고 직접 답변까지 이어가 보세요.</p><button type="button" className={styles.secondary} onClick={() => test()}>고객 여정 미리보기<ArrowRight size={15} /></button></>}</section></div>
      </>}
      {view === "teach" && !expertServerSync && <PracticeTeaching practice={practice} onChange={change} onApply={(next) => commit({ ...agent, practice: next })} onTest={test} onKnowledge={(id) => knowledge("case", id)} onContribute={contribute} />}
      {view === "teach" && expertServerSync && <LivePracticeTeaching agentId={agent.id} practice={practice} onChange={change} onTest={test} onKnowledge={(id) => knowledge("case", id)} />}
      {view === "knowledge" && expertServerSync && <LivePracticeKnowledge agentId={agent.id} practice={practice} onChange={change} onTeach={() => teach("manual")} onTest={test} />}
      {view === "knowledge" && !expertServerSync && <PracticeKnowledge practice={practice} onChange={change} onTeach={() => teach("manual")} onTest={test} onContribute={contribute} />}
      {view === "principles" && <Principles agent={agent} onChange={onChange} />}
      {view === "preview" && expertServerSync && <RealPreview initialQuery={preview.query} />}
      {view === "preview" && (demo ? <DemoComparison /> : <PracticeRehearsal practice={practice} expertName={expertName} agentName={agent.name} preview={preview} onPreview={setPreview} onChange={change} onInbox={(id) => router.push(`${agentHref("inbox", agent.id)}&review=${encodeURIComponent(id)}`)} />)}
      <footer className={styles.footnote}>{expertServerSync ? "변경 저장을 누르면 서버에 보관됩니다. 나에게 연결된 상담방의 세무사 AI 는 '연결 상담방에서 쓰는 에이전트'의 운영 원칙·확인 질문을 따르고, 게시한 답변 사례를 근거로 찾습니다. 고객 여정 미리보기는 이 브라우저 안의 시뮬레이션입니다." : "이 공간의 사례와 대화는 프로토타입 예시입니다. 실제 상담이나 모델 학습은 실행되지 않습니다."}</footer>
    </div>
  </>;
}

function Principles({ agent, onChange }: { agent: PracticeAgent; onChange: (agent: PracticeAgent) => void }) {
  const practice = agent.practice;
  function change(patch: Partial<Practice>) { onChange({ ...agent, practice: { ...practice, ...patch } }); }
  function policy(patch: Partial<Practice["policy"]>) { change({ policy: { ...practice.policy, ...patch } }); }
  return <>
    <SectionTitle title="나의 상담 원칙" description="AI가 지킬 기준과, 내가 직접 참여할 순간을 정합니다." />
    <PracticeRules practice={practice} onChange={(next) => onChange({ ...agent, practice: next })} />
    <details className={styles.guidanceDetails}><summary>상담 소개·말투·직접 참여 상태</summary>
    <div className={styles.principlesGrid}><section className={styles.paper}><div className={styles.panelHead}><h3>어떤 상담을 제공하나요?</h3><ShieldCheck size={21} strokeWidth={1.5} /></div><div className={styles.form}>
      <TextField label="에이전트 이름" value={agent.name} onChange={(name) => onChange({ ...agent, name })} short maxLength={100} />
      <TextField label="고객에게 전할 소개" value={practice.introduction} onChange={(introduction) => change({ introduction })} />
      <label className={styles.field}>답변의 말투<select value={practice.voice} onChange={(event) => change({ voice: event.target.value as Practice["voice"] })}><option value="clear">명확하게 · 판단 이유와 함께</option><option value="warm">따뜻하게 · 안심할 수 있도록</option><option value="concise">간결하게 · 결론을 중심으로</option></select></label>
      <TextField label="상담할 수 있는 분야" value={practice.policy.scope} onChange={(scope) => policy({ scope })} />
      <TextField label="직접 다룰 제외 사항" value={practice.policy.exclusions} onChange={(exclusions) => policy({ exclusions })} hint="예외 상황 미리보기와 함께 검토할 상담 경계입니다." />
      <TextField label="항상 지킬 원칙" value={practice.policy.rules} onChange={(rules) => policy({ rules })} hint={expertServerSync ? "적은 원칙은 변경 저장 때 서버에 보관되고, 연결 상담방의 세무사 AI 가 따릅니다(규칙엔진 판정·근거 규칙이 우선합니다)." : "자유롭게 적은 원칙은 기록됩니다. 이 프로토타입의 AI가 문장의 의미를 자동 해석하지는 않습니다."} />
    </div></section><div className={styles.principlesAside}><section className={styles.paper}><div className={styles.panelHead}><h3>직접 참여의 기본 원칙</h3><UserRound size={21} strokeWidth={1.5} /></div><div className={styles.form}>
      <div className={styles.fixedRule}><Check size={16} /><p>고객이 직접 상담을 원하면 언제나 요청할 수 있습니다.</p></div>
    </div></section><section className={styles.paper}><div className={styles.panelHead}><h3>직접 참여 상태</h3></div><div className={styles.form}><Toggle label="지금 참여 가능" description="부재중이어도 고객의 요청은 대기 상태로 남습니다." checked={practice.policy.available} onChange={(available) => policy({ available })} /><p className={styles.hint}>미리보기 요청함에 적용되는 데모 상태입니다.</p></div></section></div></div>
    </details>
  </>;
}
