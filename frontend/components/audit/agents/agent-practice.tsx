"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowRight, BookOpen, Bot, Check, ChevronRight, Copy, FileQuestion, GraduationCap, Inbox, MessageCircle, Play, Plus, Save, Settings2, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { useAccountStore } from "@/lib/account-store";
import { createAgent, loadAgents, saveAgents, type Agent } from "@/lib/agent-studio";
import { blankLesson, createPractice, type Practice } from "@/lib/agent-practice";
import { PracticeTeaching } from "./practice-teaching";
import { PracticeKnowledge } from "./practice-knowledge";
import { initialPreview, PracticeInbox, PracticeRehearsal } from "./practice-rehearsal";
import { Provenance, SectionTitle, TextField, Toggle } from "./practice-ui";
import styles from "./agent-practice.module.css";

type PracticeAgent = Agent & { practice: Practice };
type View = "overview" | "teach" | "knowledge" | "principles" | "preview" | "inbox";
const navigation = [{ id: "overview", label: "한눈에 보기", icon: Sparkles }, { id: "teach", label: "가르치기", icon: GraduationCap }, { id: "knowledge", label: "지식 모음", icon: BookOpen }, { id: "principles", label: "운영 원칙", icon: ShieldCheck }, { id: "preview", label: "미리보기", icon: Play }, { id: "inbox", label: "참여 요청", icon: Inbox }] as const;
const subscribe = () => () => {};

export function AgentPractice() {
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const owner = useAccountStore((state) => state.auditor.id);
  const expertName = useAccountStore((state) => state.auditor.reviewerName);
  return ready ? <PracticeLibrary key={owner} owner={owner} expertName={expertName} /> : <p className="p-6" role="status">나의 에이전트를 불러오는 중…</p>;
}

function PracticeLibrary({ owner, expertName }: { owner: string; expertName: string }) {
  const [initial] = useState(() => {
    try {
      const saved = loadAgents(window.localStorage, owner);
      const agents = (saved.length ? saved : [createAgent(owner)]).map((agent) => ({ ...agent, practice: agent.practice ?? createPractice() }));
      return { agents, persisted: saved.length > 0 && saved.every((agent) => !!agent.practice), error: "" };
    } catch { return { agents: [{ ...createAgent(owner), practice: createPractice() }], persisted: false, error: "저장된 설정을 읽지 못했습니다. 기존 데이터는 그대로 보존되어 있습니다. 다시 불러오거나 샘플로 대체할 수 있습니다." }; }
  });
  const [agents, setAgents] = useState<PracticeAgent[]>(initial.agents);
  const [selectedId, setSelectedId] = useState(initial.agents[0].id);
  const [saved, setSaved] = useState(JSON.stringify(initial.agents));
  const [persisted, setPersisted] = useState(initial.persisted);
  const [locked, setLocked] = useState(!!initial.error);
  const [error, setError] = useState(initial.error);
  const [notice, setNotice] = useState("");
  const agent = agents.find((item) => item.id === selectedId)!;
  const dirty = JSON.stringify(agents) !== saved;
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  function update(next: PracticeAgent) { setAgents((items) => items.map((item) => item.id === next.id ? next : item)); setNotice(""); }
  function save() {
    if (locked) return;
    if (agents.some((item) => !item.name.trim())) { setError("에이전트 이름을 입력한 뒤 다시 저장해 주세요."); return; }
    try { saveAgents(window.localStorage, owner, agents); setSaved(JSON.stringify(agents)); setPersisted(true); setError(""); setNotice("이 브라우저에 변경 사항을 저장했습니다."); }
    catch { setError("저장하지 못했습니다. 입력 내용은 유지됩니다. 저장 공간과 입력 길이를 확인한 뒤 변경 저장을 다시 눌러 주세요."); }
  }
  function add(copy = false) {
    const next = copy ? { ...structuredClone(agent), id: crypto.randomUUID(), name: `${agent.name.slice(0, 90)} 사본` } : { ...createAgent(owner), practice: createPractice() };
    setAgents((items) => [...items, next]); setSelectedId(next.id); setNotice("");
  }
  return <section className={styles.studio} aria-label="전문가 에이전트 워크스페이스">
    <header className={styles.toolbar}><div className={styles.identity}><div className={styles.agentMark}><Bot size={25} strokeWidth={1.6} /></div><div><h1>내 에이전트</h1><span>{expertName} 전문가의 상담 기준</span></div></div><div className={styles.actions}><span className={styles.saveState} aria-live="polite">{dirty ? "저장하지 않은 변경" : persisted ? "브라우저에 저장됨" : "예시로 시작한 초안"}</span><button type="button" className={styles.primary} disabled={locked} onClick={save}><Save size={16} />변경 저장</button></div></header>
    <div className={styles.agentBar}><label><span className={styles.srOnly}>에이전트 선택</span><select aria-label="에이전트 선택" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{agents.map((item) => <option value={item.id} key={item.id}>{item.name || "이름 없는 에이전트"}</option>)}</select></label><button type="button" className={styles.textButton} disabled={agents.length >= 30} onClick={() => add()}><Plus size={15} />새 에이전트</button><button type="button" className={styles.textButton} disabled={agents.length >= 30} onClick={() => add(true)}><Copy size={14} />복제</button><span className={styles.localLabel}>프로토타입 · 이 브라우저에만 저장</span></div>
    {(error || notice) && <div role={error ? "alert" : "status"} className={error ? styles.error : styles.notice}>{error || notice}{locked && <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => window.location.reload()}>다시 불러오기</button><button type="button" className={styles.secondary} onClick={() => { setLocked(false); setError(""); setNotice("샘플을 열었습니다. 변경 저장을 누르면 이전 저장 데이터를 이 샘플로 대체합니다."); }}>샘플로 대체 준비</button></div>}</div>}
    <Workspace key={agent.id} agent={agent} expertName={expertName} onChange={update} dirty={dirty} onNotice={setNotice} />
  </section>;
}

function Workspace({ agent, expertName, onChange, dirty, onNotice }: { agent: PracticeAgent; expertName: string; onChange: (agent: PracticeAgent) => void; dirty: boolean; onNotice: (notice: string) => void }) {
  const [view, setView] = useState<View>("overview");
  const [preview, setPreview] = useState(initialPreview);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const practice = agent.practice;
  const pending = practice.reviews.filter((review) => review.status !== "resolved");
  function change(next: Practice) { onChange({ ...agent, practice: next }); }
  function teach() { if (practice.lesson.step === 3) change({ ...practice, lesson: blankLesson() }); setView("teach"); }
  function test(query?: string) { setPreview((current) => ({ ...initialPreview(), phase: query ? 2 : current.phase, query: query || current.query })); setView("preview"); }
  useEffect(() => { content.current?.scrollTo({ top: 0 }); content.current?.querySelector<HTMLElement>("[data-task-heading]")?.focus({ preventScroll: true }); }, [view]);
  return <>
    <nav className={styles.navigation} aria-label="에이전트 작업">
      <div className={styles.desktopNavigation}>{navigation.map(({ id, label, icon: Icon }) => <button type="button" key={id} aria-current={view === id ? "page" : undefined} onClick={() => setView(id)}><Icon size={16} /><span>{label}</span>{id === "inbox" && pending.length > 0 && <span className={styles.count}>{pending.length}</span>}</button>)}</div>
      <label className={styles.mobileNavigation}><span className={styles.srOnly}>에이전트 작업 선택</span><select value={view} onChange={(event) => setView(event.target.value as View)}>{navigation.map(({ id, label }) => <option value={id} key={id}>{label}{id === "inbox" && pending.length ? ` (${pending.length})` : ""}</option>)}</select></label>
      <button type="button" className={styles.mobileInbox} aria-current={view === "inbox" ? "page" : undefined} onClick={() => setView("inbox")}>참여 요청{pending.length > 0 && <span className={styles.count}>{pending.length}</span>}</button>
      <Link aria-label="고급 설정" className={styles.advanced} href="/audit/agents/advanced" onClick={(event) => { if (dirty) { event.preventDefault(); onNotice("변경 사항을 저장한 뒤 고급 설정을 열어 주세요."); } }}><Settings2 size={15} /><span>고급 설정</span></Link>
    </nav>
    <div className={styles.content} ref={content}>
      {view === "overview" && <>
        <div className={styles.overviewHero}><div className={styles.invitation}><h2 tabIndex={-1} data-task-heading>나의 판단을,<br />AI의 기준으로.</h2><p>어떤 사실을 확인하고, 어떻게 답하고,<br className={styles.desktopBreak} /> 언제 내가 함께할지. 나다운 상담을 가르쳐 주세요.</p><button type="button" className={styles.primary} onClick={teach}><GraduationCap size={18} />{practice.lesson.title && practice.lesson.step < 3 ? "이어서 가르치기" : "사례 하나로 시작하기"}<ArrowRight size={17} /></button><span className={styles.hint}>익숙한 상담 사례 하나면 충분합니다.</span></div>
          <div className={styles.roleMap} aria-label="에이전트의 세 가지 역할"><div className={styles.roleMapHeader}><span>나의 기준으로 이어지는 상담</span><span className={styles.liveDot} aria-hidden="true" /></div>{[{ icon: FileQuestion, title: "먼저 이해하고", body: "질문으로 사실을 확인합니다", foot: `${practice.questions.filter((item) => item.enabled).length}개의 확인 질문`, target: "knowledge" }, { icon: BookOpen, title: "근거를 담아 답하고", body: "나의 사례와 판단을 참고합니다", foot: `${practice.cases.filter((item) => item.enabled).length}개의 사용 중인 사례`, target: "knowledge" }, { icon: UserRound, title: "필요한 순간, 나와 함께", body: "직접 참여할 때를 알아봅니다", foot: "내가 정한 참여 기준", target: "principles" }].map(({ icon: Icon, title, body, foot, target }, index) => <button type="button" key={title} aria-label={`${title}: ${foot}`} className={styles.roleStep} onClick={() => setView(target as View)}><span className={styles.roleIcon} data-tone={index}><Icon size={21} strokeWidth={1.6} /></span><span><strong>{title}</strong><span>{body}</span></span><small>{foot}<ChevronRight size={13} /></small></button>)}</div>
        </div>
        <div className={styles.overviewBottom}><section className={styles.overviewKnowledge}><div className={styles.panelHead}><h3>에이전트에 담긴 지식</h3><button type="button" className={styles.textButton} onClick={() => setView("knowledge")}>모두 보기<ArrowRight size={14} /></button></div>{practice.cases.slice(-3).reverse().map((entry) => <button type="button" className={styles.knowledgeRow} key={entry.id} onClick={() => setView("knowledge")}><span><Provenance sample={entry.origin === "sample"} /><strong>{entry.title}</strong><span className={styles.rowMeta}>사실 · 판단 · 결론{entry.exceptions ? " · 예외" : ""}</span></span><ArrowRight size={16} /></button>)}</section><section className={styles.attention}><div className={styles.panelHead}><h3>내가 함께할 순간</h3><MessageCircle size={20} strokeWidth={1.5} /></div>{pending.length ? <><strong className={styles.attentionTitle}>{pending.length}개의 대화가 기다립니다</strong><p>{pending[0].reason}</p><button type="button" className={styles.secondary} onClick={() => { setReviewId(pending[0].id); setView("inbox"); }}>대화 살펴보기<ArrowRight size={15} /></button></> : <><strong className={styles.attentionTitle}>참여할 대화가 생기면,<br />맥락과 함께 알려드립니다.</strong><p>고객 여정을 시험하고 직접 답변까지 이어가 보세요.</p><button type="button" className={styles.secondary} onClick={() => test()}>고객 여정 미리보기<ArrowRight size={15} /></button></>}</section></div>
      </>}
      {view === "teach" && <PracticeTeaching practice={practice} onChange={change} onTest={test} onKnowledge={() => setView("knowledge")} />}
      {view === "knowledge" && <PracticeKnowledge practice={practice} onChange={change} onTeach={teach} onTest={test} />}
      {view === "principles" && <Principles agent={agent} onChange={onChange} />}
      {view === "preview" && <PracticeRehearsal practice={practice} expertName={expertName} agentName={agent.name} preview={preview} onPreview={setPreview} onChange={change} onInbox={(id) => { setReviewId(id); setView("inbox"); }} />}
      {view === "inbox" && <PracticeInbox practice={practice} onChange={change} selectedId={reviewId} onSelect={setReviewId} onPreview={() => setView("preview")} />}
      <footer className={styles.footnote}>이 공간의 사례와 대화는 프로토타입 예시입니다. 실제 상담이나 모델 학습은 실행되지 않습니다.</footer>
    </div>
  </>;
}

function Principles({ agent, onChange }: { agent: PracticeAgent; onChange: (agent: PracticeAgent) => void }) {
  const practice = agent.practice;
  function change(patch: Partial<Practice>) { onChange({ ...agent, practice: { ...practice, ...patch } }); }
  function policy(patch: Partial<Practice["policy"]>) { change({ policy: { ...practice.policy, ...patch } }); }
  return <>
    <SectionTitle title="나의 상담 원칙" description="AI가 지킬 기준과, 내가 직접 참여할 순간을 정합니다." />
    <div className={styles.principlesGrid}><section className={styles.paper}><div className={styles.panelHead}><h3>어떤 상담을 제공하나요?</h3><ShieldCheck size={21} strokeWidth={1.5} /></div><div className={styles.form}>
      <TextField label="에이전트 이름" value={agent.name} onChange={(name) => onChange({ ...agent, name })} short maxLength={100} />
      <TextField label="고객에게 전할 소개" value={practice.introduction} onChange={(introduction) => change({ introduction })} />
      <label className={styles.field}>답변의 말투<select value={practice.voice} onChange={(event) => change({ voice: event.target.value as Practice["voice"] })}><option value="clear">명확하게 · 판단 이유와 함께</option><option value="warm">따뜻하게 · 안심할 수 있도록</option><option value="concise">간결하게 · 결론을 중심으로</option></select></label>
      <TextField label="상담할 수 있는 분야" value={practice.policy.scope} onChange={(scope) => policy({ scope })} />
      <TextField label="직접 다룰 제외 사항" value={practice.policy.exclusions} onChange={(exclusions) => policy({ exclusions })} hint="예외 상황 미리보기와 함께 검토할 상담 경계입니다." />
      <TextField label="항상 지킬 원칙" value={practice.policy.rules} onChange={(rules) => policy({ rules })} hint="자유롭게 적은 원칙은 기록됩니다. 이 프로토타입의 AI가 문장의 의미를 자동 해석하지는 않습니다." />
    </div></section><div className={styles.principlesAside}><section className={styles.paper}><div className={styles.panelHead}><h3>언제 나를 불러야 하나요?</h3><UserRound size={21} strokeWidth={1.5} /></div><div className={styles.form}>
      <Toggle label="사실이 부족할 때" description="추가 질문과 함께 직접 참여를 권합니다." checked={practice.policy.onMissing} onChange={(onMissing) => policy({ onMissing })} />
      <Toggle label="자료가 서로 다를 때" description="엇갈린 사실을 직접 확인합니다." checked={practice.policy.onConflict} onChange={(onConflict) => policy({ onConflict })} />
      <Toggle label="예외에 해당할 때" description="일반 사례의 결론을 적용하기 전에 확인합니다." checked={practice.policy.onException} onChange={(onException) => policy({ onException })} />
      <div className={styles.fixedRule}><Check size={16} /><p>고객이 직접 상담을 원하면 언제나 요청할 수 있습니다.</p></div>
    </div></section><section className={styles.paper}><div className={styles.panelHead}><h3>직접 참여 상태</h3></div><div className={styles.form}><Toggle label="지금 참여 가능" description="부재중이어도 고객의 요청은 대기 상태로 남습니다." checked={practice.policy.available} onChange={(available) => policy({ available })} /><p className={styles.hint}>미리보기 요청함에 적용되는 데모 상태입니다.</p></div></section></div></div>
  </>;
}
