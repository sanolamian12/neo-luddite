"use client";

import Link from "next/link";
import { agentHref } from "@/lib/agent-navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, CheckCheck, ChevronDown, Copy, FileSearch, GitBranch, MessageSquareText, Play, Plus, Save, SlidersHorizontal, Square, Trash2, UserRound, Workflow } from "lucide-react";
import { LibraryFeedback, MissingAgent, useAgentLibrary } from "./agent-library";
import { conditionLabels, createStage, orderedStages, payloadLabels, removeStage, scenarioLabels, simulateAgent, stageLabels, validateAgent, type Agent, type AgentRun, type Connection, type RunStep, type Scenario, type Stage } from "@/lib/agent-studio";
import styles from "./agent-studio.module.css";

const icons = { facts: FileSearch, answer: MessageSquareText, handoff: UserRound };
const statusLabels = { complete: "완료", blocked: "입력 확인 필요", skipped: "건너뜀" };
export function AgentStudio() {
  const { agent } = useAgentLibrary();
  return agent ? <><div className="flex flex-wrap items-center gap-3 px-6 pt-4 text-sm"><Link href={agentHref("overview", agent.id)} className="underline underline-offset-4">← 내 에이전트로</Link><p>고급 모델·연결 설정 · 지식 모음과 별도로 실행되는 그래프 시뮬레이션입니다.</p></div><Studio key={agent.id} /></> : <MissingAgent />;
}

function Studio() {
  const library = useAgentLibrary();
  const { agents, dirty, persisted, locked } = library;
  const agent = library.agent!;
  const agentId = agent.id;
  const setAgentId = library.select;
  const studioRef = useRef<HTMLElement>(null);
  const [selectedId, setSelectedId] = useState(agent.entry);
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<"flow" | "settings" | "test">("flow");
  const [addKind, setAddKind] = useState<Stage["kind"]>("answer");
  const [scenario, setScenario] = useState<Scenario>("missing");
  const [question, setQuestion] = useState("업무용 장비를 구입했는데 어떤 자료를 준비하면 될까요?");
  const [run, setRun] = useState<AgentRun | null>(null);
  const [visible, setVisible] = useState(0);
  const [running, setRunning] = useState(false);
  const [traceId, setTraceId] = useState<string | null>(null);
  const [inspectionRequest, setInspectionRequest] = useState(0);
  const selected = agent.nodes.find((node) => node.id === selectedId);
  const issues = validateAgent(agent);

  useEffect(() => {
    if (window.matchMedia("(max-width: 900px)").matches && !(view === "test" && traceId)) studioRef.current?.scrollTo({ top: 0 });
    studioRef.current?.querySelector("aside")?.scrollTo({ top: 0 });
  }, [selectedId, view, traceId]);

  useEffect(() => {
    if (!running || !run) return;
    let count = 0;
    const timer = window.setInterval(() => {
      count += 1; setVisible(count);
      if (count >= run.steps.length) { setRunning(false); window.clearInterval(timer); }
    }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 60 : 650);
    return () => window.clearInterval(timer);
  }, [running, run]);

  function update(next: Agent) {
    library.update(next);
    setRun(null); setVisible(0); setTraceId(null); setNotice("");
  }
  function updateStage(patch: Partial<Stage>) {
    update({ ...agent, nodes: agent.nodes.map((node) => node.id === selectedId ? { ...node, ...patch } : node) });
  }
  function chooseStage(id: string) { setSelectedId(id); setView("settings"); }
  function inspectStage(id: string) { setSelectedId(id); setTraceId(id); setInspectionRequest((request) => request + 1); setView("test"); }
  const save = library.save;
  function addAgent(copy: boolean) { library.add(copy); }
  function startRun() {
    try { const next = simulateAgent(agent, scenario, question); setRun(next); setVisible(0); setTraceId(null); setRunning(true); setView("test"); setNotice(""); }
    catch (error) { setNotice(error instanceof Error ? error.message : "연결을 확인해 주세요."); }
  }

  return <section ref={studioRef} className={styles.studio} aria-label="내 에이전트 스튜디오">
    <header className={styles.toolbar}>
      <div className={styles.title}><Workflow size={22} /><h1>내 에이전트</h1><span className={styles.tag}>프로토타입</span></div>
      <div className={styles.actions}>
        <span className={styles.saveState}>{dirty ? "저장하지 않은 변경" : persisted ? "이 브라우저에 저장됨" : "샘플 초안"}</span>
        <button type="button" className={styles.secondary} disabled={running || agents.length >= 30} onClick={() => addAgent(true)}><Copy size={15} />복제</button>
        <button type="button" className={styles.primary} onClick={save} disabled={locked}><Save size={15} />변경 저장</button>
      </div>
    </header>
    <div className={styles.agentBar}>
      <label className={styles.agentPicker}><span>에이전트</span><select aria-label="에이전트 선택" value={agentId} disabled={running} onChange={(event) => { const next = agents.find((item) => item.id === event.target.value)!; setAgentId(next.id); setSelectedId(next.entry); setRun(null); }}>
        {agents.map((item) => <option key={item.id} value={item.id}>{item.name || "이름 없는 에이전트"}</option>)}
      </select></label>
      <button type="button" className={styles.textButton} disabled={running || agents.length >= 30} onClick={() => addAgent(false)}><Plus size={15} />새 에이전트</button>
      <p className={styles.localNote}>전문가별 데모 설정 · 현재 브라우저에만 저장</p>
    </div>
    <LibraryFeedback />
    {notice && <div className={styles.notice} role="status">{notice}</div>}
    <nav className={styles.mobileTabs} aria-label="에이전트 작업 영역">
      {(["flow", "settings", "test"] as const).map((tab) => <button type="button" key={tab} aria-pressed={view === tab} onClick={() => setView(tab)}>{tab === "flow" ? "워크플로" : tab === "settings" ? "단계 설정" : "테스트"}</button>)}
    </nav>
    <div className={styles.workspace} data-view={view}>
      <section className={styles.flow} aria-label="워크플로 편집">
        <div className={styles.sectionHead}><div><h2>상담이 만들어지는 흐름</h2><p>단계를 선택해 지시문과 연결을 편집하세요.</p></div>
          <div className={styles.addStage}><select aria-label="추가할 단계 유형" value={addKind} disabled={running} onChange={(event) => setAddKind(event.target.value as Stage["kind"])}>{Object.entries(stageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <button type="button" className={styles.secondary} disabled={running || agent.nodes.length >= 12} onClick={() => {
              const node = createStage(addKind);
              const from = selected ?? agent.nodes.at(-1);
              update({ ...agent, entry: agent.nodes.length ? agent.entry : node.id, nodes: [...agent.nodes, node], edges: from ? [...agent.edges, { id: crypto.randomUUID(), from: from.id, to: node.id, condition: "always", payload: "all" }] : agent.edges });
              chooseStage(node.id);
            }}><Plus size={15} />단계 추가</button>
          </div>
        </div>
        <Graph agent={agent} selectedId={selectedId} onSelect={chooseStage} onInspect={inspectStage} run={run} visible={visible} running={running} />
        <div className={styles.flowFooter}><span><span className={styles.dot} />{agent.nodes.length}개 단계 · {agent.edges.length}개 연결</span><span>연결선: 전달 데이터 / 실행 조건</span></div>
        {issues.length > 0 && <div className={styles.issueBox} role="status"><strong>테스트 전에 확인하세요</strong><ul>{issues.map((issue) => <li key={issue.code}>{issue.message}</li>)}</ul></div>}
      </section>

      <aside className={styles.inspector} aria-label="단계 설정">
        <div className={styles.inspectorHead}><SlidersHorizontal size={17} /><h2>단계 설정</h2><span>{selected ? stageLabels[selected.kind] : "선택 없음"}</span></div>
        <fieldset disabled={running} className={styles.fields}>
          {selected ? <>
            <label>단계 이름<input value={selected.name} maxLength={100} onChange={(event) => updateStage({ name: event.target.value })} /></label>
            <label>모델 프리셋<select value={selected.model} onChange={(event) => updateStage({ model: event.target.value as Stage["model"] })}><option value="fast">빠른 모델 · 데모</option><option value="thorough">정밀 모델 · 데모</option></select></label>
            <label>지시문<textarea className={styles.instructions} value={selected.instructions} maxLength={12000} onChange={(event) => updateStage({ instructions: event.target.value })} /></label>
            <p className={styles.hint}>테스트 기록에 지시문을 전달합니다. 실제 모델의 해석과 답변 생성은 연결하지 않았습니다.</p>
            <label>참고 자료 메모<textarea rows={2} value={selected.sources} maxLength={4000} onChange={(event) => updateStage({ sources: event.target.value })} /></label>
            <p className={styles.hint}>참고할 자료를 메모하세요. 자료 검색은 시뮬레이션 범위에 포함되지 않습니다.</p>
            {selected.kind === "handoff" && <div className={styles.handoffSettings}>
              <h3>전문가 연결 조건</h3>
              <label>신뢰도가 <strong>{selected.threshold}%</strong> 미만일 때<input aria-label="전문가 연결 신뢰도 기준" type="range" min="0" max="100" value={selected.threshold} onChange={(event) => updateStage({ threshold: Number(event.target.value) })} /></label>
              <label className={styles.checkbox}><input type="checkbox" checked={selected.onMissing} onChange={(event) => updateStage({ onMissing: event.target.checked })} />확인되지 않은 사실이 있으면 연결 권장</label>
            </div>}
            <Connections agent={agent} selected={selected} onChange={update} />
            <button type="button" className={styles.dangerButton} onClick={() => { const next = removeStage(agent, selected.id); update(next); setSelectedId(next.nodes[0]?.id ?? ""); }}><Trash2 size={15} />이 단계 삭제</button>
          </> : <p className={styles.empty}>워크플로에서 단계를 선택하거나 새 단계를 추가하세요.</p>}
          <div className={styles.rule} />
          <h3>에이전트 설정</h3>
          <label>에이전트 이름<input value={agent.name} maxLength={100} onChange={(event) => update({ ...agent, name: event.target.value })} /></label>
          <label>시작 단계<select value={agent.nodes.some((node) => node.id === agent.entry) ? agent.entry : ""} onChange={(event) => update({ ...agent, entry: event.target.value })}><option value="" disabled>시작 단계를 선택하세요</option>{agent.nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label>
        </fieldset>
      </aside>

      <section className={styles.testPanel} aria-label="에이전트 테스트">
        <div className={styles.sectionHead}><div><h2>테스트 대화</h2><p>샘플 응답과 신뢰도로 실행 흐름을 확인합니다.</p></div><span className={styles.tag}>시뮬레이션</span></div>
        <div className={styles.testBody}>
          <div className={styles.testControls}>
            <label>테스트 상황<select value={scenario} disabled={running} onChange={(event) => { setScenario(event.target.value as Scenario); setRun(null); }}>{Object.entries(scenarioLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>고객 질문<textarea rows={2} maxLength={2000} value={question} disabled={running} onChange={(event) => { setQuestion(event.target.value); setRun(null); }} /></label>
            {issues.length > 0 && <div className={styles.issueBox} role="status"><strong>이 설정으로는 테스트할 수 없습니다</strong><ul>{issues.map((issue) => <li key={issue.code}>{issue.message}</li>)}</ul><button type="button" className={styles.textButton} onClick={() => setView("settings")}>단계와 연결 수정<ArrowRight size={14} /></button><button type="button" className={styles.textButton} onClick={() => setView("flow")}>워크플로 확인<ArrowRight size={14} /></button></div>}
            <div className={styles.testActions}><p className={styles.hint}>응답은 선택한 상황의 예시입니다. 질문과 지시문은 기록되며, 실제 LLM은 호출하지 않습니다.</p><button type="button" className={styles.primary} disabled={!running && (!!issues.length || !question.trim())} onClick={running ? () => { setRunning(false); setRun(null); setVisible(0); } : startRun}>{running ? <><Square size={14} />중지</> : <><Play size={15} />테스트 실행</>}</button></div>
          </div>
          {run ? <RunResults run={run} entryId={agent.entry} inspectedId={traceId} inspectionRequest={inspectionRequest} visible={visible} running={running} onSelect={chooseStage} /> : <div className={styles.testEmpty}><GitBranch size={26} /><p>내 지시문이 어떤 단계에 전달되는지,<br />어떤 조건에서 전문가 연결을 권하는지 확인하세요.</p></div>}
        </div>
      </section>
    </div>
  </section>;
}

function Connections({ agent, selected, onChange }: { agent: Agent; selected: Stage; onChange: (agent: Agent) => void }) {
  const outgoing = agent.edges.filter((edge) => edge.from === selected.id);
  const available = agent.nodes.filter((node) => node.id !== selected.id && !outgoing.some((edge) => edge.to === node.id));
  function edit(id: string, patch: Partial<Connection>) { onChange({ ...agent, edges: agent.edges.map((edge) => edge.id === id ? { ...edge, ...patch } : edge) }); }
  return <section className={styles.connections}>
    <h3>다음 단계로 연결 <span>{outgoing.length}</span></h3>
    {outgoing.map((edge, index) => <div className={styles.connection} key={edge.id}>
      <div className={styles.connectionTitle}><ArrowRight size={15} /><strong>{agent.nodes.find((node) => node.id === edge.to)?.name ?? "삭제된 단계"}</strong><button type="button" className={styles.iconButton} aria-label={`${index + 1}번 연결 삭제`} onClick={() => onChange({ ...agent, edges: agent.edges.filter((item) => item.id !== edge.id) })}><Trash2 size={15} /></button></div>
      <label>연결할 단계<select value={edge.to} onChange={(event) => edit(edge.id, { to: event.target.value })}>{agent.nodes.filter((node) => node.id !== selected.id && (node.id === edge.to || !outgoing.some((item) => item.to === node.id))).map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label>
      <label>전달 데이터<select value={edge.payload} onChange={(event) => edit(edge.id, { payload: event.target.value as Connection["payload"] })}>{Object.entries(payloadLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>실행 조건<select value={edge.condition} onChange={(event) => edit(edge.id, { condition: event.target.value as Connection["condition"] })}>{Object.entries(conditionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>)}
    {!outgoing.length && <p className={styles.hint}>이 단계에서 흐름이 끝납니다.</p>}
    <label>새 연결 추가<select aria-label="새 연결 대상" value="" disabled={!available.length} onChange={(event) => { if (event.target.value) onChange({ ...agent, edges: [...agent.edges, { id: crypto.randomUUID(), from: selected.id, to: event.target.value, payload: "all", condition: "always" }] }); }}><option value="">{available.length ? "연결할 단계를 선택하세요" : "연결 가능한 단계가 없습니다"}</option>{available.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label>
  </section>;
}

function Graph({ agent, selectedId, onSelect, onInspect, run, visible, running }: { agent: Agent; selectedId: string; onSelect: (id: string) => void; onInspect: (id: string) => void; run: AgentRun | null; visible: number; running: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const sorted = orderedStages(agent);
  const nodes = [...sorted, ...agent.nodes.filter((node) => !sorted.some((item) => item.id === node.id))];
  const levels = new Map<string, number>();
  const rows = new Map<number, number>();
  const rowHeight = 226 + Math.max(1, ...nodes.map((node) => agent.edges.filter((edge) => edge.from === node.id).length)) * 28;
  const positions = new Map(nodes.map((node) => {
    const level = Math.max(0, ...agent.edges.filter((edge) => edge.to === node.id).map((edge) => (levels.get(edge.from) ?? -1) + 1));
    levels.set(node.id, level);
    const row = rows.get(level) ?? 0; rows.set(level, row + 1);
    return [node.id, { x: 24 + level * 266, y: 62 + row * rowHeight }];
  }));
  const width = Math.max(810, ...[...positions.values()].map((position) => position.x + 254));
  const height = Math.max(290, ...[...positions.values()].map((position) => position.y + rowHeight));
  const activeId = running ? run?.steps[visible]?.nodeId : null;
  useEffect(() => {
    if (!activeId) return;
    const element = container.current?.querySelector<HTMLButtonElement>(`[data-stage-id="${CSS.escape(activeId)}"]`);
    if (element && container.current) container.current.scrollTo({ left: Math.max(0, (element.parentElement?.offsetLeft ?? 0) - 36), top: Math.max(0, (element.parentElement?.offsetTop ?? 0) - 62), behavior: "auto" });
  }, [activeId]);
  return <div className={styles.canvasScroll} ref={container} tabIndex={0} aria-label="워크플로 캔버스. 좌우로 스크롤할 수 있습니다.">
    <div className={styles.canvas} style={{ width, height }}>
      <svg className={styles.edges} width={width} height={height} aria-hidden="true">
        <defs><marker id="agent-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
        {agent.edges.map((edge) => { const from = positions.get(edge.from), to = positions.get(edge.to); if (!from || !to) return null;
          const used = run?.steps.slice(0, visible).some((step) => step.edgeIds.includes(edge.id));
          return <path key={edge.id} className={used ? styles.usedEdge : undefined} d={`M ${from.x + 230} ${from.y + 88} C ${from.x + 264} ${from.y + 88}, ${to.x - 34} ${to.y + 88}, ${to.x - 4} ${to.y + 88}`} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={edge.condition === "always" ? undefined : "5 4"} markerEnd="url(#agent-arrow)" />;
        })}
      </svg>
      {nodes.map((node) => { const position = positions.get(node.id)!; const Icon = icons[node.kind]; const step = run?.steps.slice(0, visible).find((item) => item.nodeId === node.id); const active = activeId === node.id;
        return <div className={styles.nodeGroup} key={node.id} style={{ left: position.x, top: position.y }}>
          {agent.entry === node.id && <span className={styles.entryLabel}>고객 질문에서 시작</span>}
          <button type="button" data-stage-id={node.id} className={`${styles.node} ${selectedId === node.id ? styles.selected : ""} ${active ? styles.active : ""}`} aria-pressed={selectedId === node.id} onClick={() => onSelect(node.id)}>
            <span className={styles.nodeRole}><Icon size={17} />{stageLabels[node.kind]}<span className={styles.nodeStatus}>{active ? "실행 중" : step ? statusLabels[step.status] : "LLM"}</span></span>
            <strong>{node.name || "이름 없는 단계"}</strong><span className={styles.nodePrompt}>{node.instructions || "지시문을 입력하세요"}</span>
            <span className={styles.nodeBottom}>{step?.output.confidence != null ? `샘플 신뢰도 ${step.output.confidence}%` : node.model === "fast" ? "빠른 모델" : "정밀 모델"}<SlidersHorizontal size={13} /></span>
          </button>
          {step && <button type="button" className={styles.nodeTrace} onClick={() => onInspect(node.id)} aria-label={`${node.name} 실행 기록 보기`}>실행 기록 보기<ArrowRight size={12} /></button>}
          {agent.edges.filter((edge) => edge.from === node.id).map((edge) => <button type="button" className={styles.edgeLabel} key={edge.id} onClick={() => onSelect(node.id)} aria-label={`${node.name} 연결 설정: ${payloadLabels[edge.payload]}, ${conditionLabels[edge.condition]}`}><ArrowRight size={12} />{payloadLabels[edge.payload]} · {conditionLabels[edge.condition]}</button>)}
        </div>;
      })}
      {!nodes.length && <div className={styles.emptyCanvas}>단계를 추가해 나만의 에이전트를 구성하세요.</div>}
    </div>
  </div>;
}

function RunResults({ run, entryId, inspectedId, inspectionRequest, visible, running, onSelect }: { run: AgentRun; entryId: string; inspectedId: string | null; inspectionRequest: number; visible: number; running: boolean; onSelect: (id: string) => void }) {
  const shown = run.steps.slice(0, visible);
  const answer = [...shown].reverse().find((step) => step.kind === "answer" && step.status === "complete");
  const handoff = shown.find((step) => step.handoff === true);
  return <div className={styles.results}>
    <div className={styles.runStatus} role="status">{running ? <><span className={styles.runningDot} />{run.steps[visible]?.name} 실행 중…</> : <><CheckCheck size={16} />시뮬레이션 완료 · {shown.filter((step) => step.status === "complete").length}/{run.steps.length}개 단계 실행</>}</div>
    <div className={styles.customerMessage}><span>고객 질문</span><p>{run.question}</p></div>
    {answer && <div className={styles.agentMessage}><span>에이전트 · 예시 응답</span><p>{answer.output.answer}</p></div>}
    {handoff && <div className={styles.handoffResult}><UserRound size={18} /><div><strong>사람 전문가와 상담을 권합니다</strong><p>{handoff.message}</p></div></div>}
    {!running && !answer && <p className={styles.hint}>답변이 생성되지 않았습니다. 아래 실행 기록에서 조건과 입력 데이터를 확인하세요.</p>}
    <div className={styles.traceHeading}><h3>단계별 실행 기록</h3><span>신뢰도는 시연용 값입니다</span></div>
    {shown.map((step) => <TraceStep key={step.nodeId} step={step} question={run.question} scenario={run.scenario} entry={step.nodeId === entryId} focused={step.nodeId === inspectedId} inspectionRequest={inspectionRequest} onSelect={onSelect} />)}
  </div>;
}

function TraceStep({ step, question, scenario, entry, focused, inspectionRequest, onSelect }: { step: RunStep; question: string; scenario: Scenario; entry: boolean; focused: boolean; inspectionRequest: number; onSelect: (id: string) => void }) {
  const detailRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!focused || !detailRef.current) return;
    detailRef.current.open = true;
    detailRef.current.querySelector("summary")?.focus({ preventScroll: true });
    detailRef.current.scrollIntoView({ block: "start", behavior: "instant" });
  }, [focused, inspectionRequest]);
  return <details className={styles.trace} ref={detailRef} data-trace-id={step.nodeId}>
    <summary><span className={styles.traceIcon}>{step.status === "complete" ? <Check size={15} /> : <ArrowRight size={15} />}</span><strong>{step.name}</strong><span>{statusLabels[step.status]}</span><ChevronDown size={15} /></summary>
    <div className={styles.traceBody}>
      <p>{step.message}</p>
      {step.output.confidence !== null && <div className={styles.confidence}><label>샘플 신뢰도 <strong>{step.output.confidence}%</strong><meter min="0" max="100" value={step.output.confidence} /></label><p>사실 완성도: {step.output.facts.length}개 확인 · {step.output.missing.length}개 추가 확인 필요</p></div>}
      {step.output.missing.length > 0 && <p>추가 확인: {step.output.missing.join(", ")}</p>}
      {step.kind === "facts" && step.output.facts.length > 0 && <><h4>생성된 사실 기반</h4><p>{step.output.facts.join("\n")}</p></>}
      <h4>전달된 입력</h4>
      {entry && <dl className={styles.inputData}><dt>고객 질문</dt><dd>{question}</dd><dt>샘플 상황</dt><dd>{scenarioLabels[scenario]}</dd></dl>}
      <dl className={styles.inputData}>
        <dt>확인된 사실</dt><dd>{step.input.facts.join("\n") || "없음"}</dd>
        <dt>누락된 사실</dt><dd>{step.input.missing.join("\n") || "없음"}</dd>
        <dt>답변</dt><dd>{step.input.answer || "없음"}</dd>
        <dt>샘플 신뢰도</dt><dd>{step.input.confidence === null ? "전달되지 않음" : `${step.input.confidence}%`}</dd>
      </dl>
      <h4>적용할 지시문 · {step.model === "fast" ? "빠른 모델" : "정밀 모델"}</h4><pre>{step.instructions}</pre>
      <h4>참고 자료 메모</h4><p>{step.sources || "메모 없음"}</p>
      <button type="button" className={styles.textButton} onClick={() => onSelect(step.nodeId)}>이 단계 편집<ArrowRight size={14} /></button>
    </div>
  </details>;
}
