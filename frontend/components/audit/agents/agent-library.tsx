"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAccountStore } from "@/lib/account-store";
import { createAgent, loadAgents, saveAgents, type Agent } from "@/lib/agent-studio";
import { createPractice, upgradePractice, type KnowledgeCase, type Practice } from "@/lib/agent-practice";
import { loadServerAgents, saveServerAgents } from "@/services/expert-agents";
import type { ServerExpertCase } from "@/services/expert-kb3";
import { expertServerSync, useServerCases } from "./expert-server";
import styles from "./agent-practice.module.css";
import { initialPreview, type PreviewState } from "./practice-rehearsal";
import { selectAgentHref } from "@/lib/agent-navigation";
import type { ContributionPayload } from "@/lib/knowledge-contributions";
import { useDemo } from "@/components/demo/runtime";
import { expert } from "@/lib/demo/domain";

export type ContributionWorkingCopy = { payload: ContributionPayload; version: number };

export type PracticeAgent = Agent & { practice: Practice };
interface Library {
  owner: string; expertName: string; agents: PracticeAgent[]; agent: PracticeAgent | undefined;
  dirty: boolean; persisted: boolean; locked: boolean; error: string; notice: string;
  update: (agent: Agent) => void; select: (id: string) => void; add: (copy?: boolean) => void;
  save: () => void; recover: () => void;
  commit: (agent: PracticeAgent) => boolean;
  contributionEdits: Record<string, ContributionWorkingCopy>;
  setContributionEdit: (id: string, copy?: ContributionWorkingCopy) => void;
  /** 3자 방에서 쓸 에이전트(0044 D4) — 없으면 첫 에이전트. 바꾸면 '변경 저장'으로 서버에 반영. */
  roomAgentId: string | undefined; setRoomAgent: (id: string) => void;
  preview: PreviewState; setPreview: (next: PreviewState) => void;
}
const Context = createContext<Library | null>(null);
const subscribe = () => () => {};
export function AgentLibraryProvider({ children }: { children: ReactNode }) {
  const demo = useDemo();
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const owner = useAccountStore((state) => state.auditor.id);
  return demo ? <DemoLibraryState>{children}</DemoLibraryState> : ready ? <LibraryState key={owner} owner={owner}>{children}</LibraryState> : <p className="p-6" role="status">전문가 워크스페이스를 불러오는 중…</p>;
}
function DemoLibraryState({ children }: { children: ReactNode }) {
  const demo = useDemo()!;
  const [preview, setPreview] = useState(initialPreview);
  const [contributionEdits, setContributionEdits] = useState<Record<string, ContributionWorkingCopy>>({});
  const commit = (agent: PracticeAgent) => demo.act((run) => ({ ...run, agent }));
  return <Context.Provider value={{ owner: demo.run.agent.owner, expertName: expert(demo.run).displayName, agents: [demo.run.agent], agent: demo.run.agent, dirty: false, persisted: true, locked: false, error: "", notice: "", update: (agent) => { commit({ ...agent, practice: agent.practice ?? demo.run.agent.practice }); }, select: () => {}, roomAgentId: demo.run.agent.id, setRoomAgent: () => {}, add: () => {}, save: () => { commit(demo.run.agent); }, recover: () => {}, commit, preview, setPreview, contributionEdits, setContributionEdit: (id, copy) => setContributionEdits((old) => { const next = { ...old }; if (copy) next[id] = copy; else delete next[id]; return next; }) }}>{children}</Context.Provider>;
}
export function useAgentLibrary() { const value = useContext(Context); if (!value) throw new Error("AgentLibraryProvider is required"); return value; }
function LibraryState({ children, owner }: { children: ReactNode; owner: string }) {
  const expertName = useAccountStore((state) => state.auditor.reviewerName);
  const path = usePathname(), search = useSearchParams(), router = useRouter();
  const [initial] = useState(() => {
    try {
      const saved = loadAgents(window.localStorage, owner);
      const agents = (saved.length ? saved : [{ ...createAgent(owner), id: `starter-${owner}` }]).map((agent) => ({ ...agent, practice: upgradePractice(agent.practice ?? createPractice()) }));
      return { agents, persisted: saved.length > 0, error: "" };
    } catch { return { agents: [{ ...createAgent(owner), id: `starter-${owner}`, practice: createPractice() }], persisted: false, error: "저장된 설정을 읽지 못했습니다. 기존 데이터는 보존되어 있습니다. 다시 불러오거나 샘플로 대체할 수 있습니다." }; }
  });
  const [agents, setAgents] = useState(initial.agents);
  const [roomAgentId, setRoomAgentId] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState(() => expertServerSync ? "" : snapshot(initial.agents, undefined));
  const [persisted, setPersisted] = useState(!expertServerSync && initial.persisted);
  const [locked, setLocked] = useState(!!initial.error);
  const [error, setError] = useState(initial.error);
  const [notice, setNotice] = useState("");
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({});
  const [contributionEdits, setContributionEdits] = useState<Record<string, ContributionWorkingCopy>>({});
  function setContributionEdit(id: string, copy?: ContributionWorkingCopy) { setContributionEdits((items) => { const next = { ...items }; if (copy) next[id] = copy; else delete next[id]; return next; }); }
  const [emptyPreview] = useState(initialPreview);
  // live: 서버(expert_agents)가 원본이다. 브라우저 값으로 먼저 그리고, 서버 값이 오면 바꾼다(0044 D5).
  useEffect(() => {
    if (!expertServerSync) return;
    let alive = true;
    void Promise.all([loadServerAgents(), useServerCases.getState().load()]).then(([server]) => {
      if (!alive) return;
      const base = server.agents.length
        ? server.agents.map((a) => ({ ...a, practice: upgradePractice(a.practice ?? createPractice()) }))
        : initial.agents;
      const { agents: merged, added } = mergeServerCases(base, Object.values(useServerCases.getState().cases));
      setAgents(merged);
      setRoomAgentId(server.roomAgentId);
      // 서버에 없으면(첫 이용) 저장 전 상태로 둔다 — '변경 저장'이 서버에 올린다.
      setSaved(server.agents.length ? snapshot(base, server.roomAgentId) : "");
      setPersisted(server.agents.length > 0);
      if (added) setNotice(`서버에만 있던 답변 사례 ${added}건을 지식 모음에 불러왔습니다. 변경 저장으로 보관하세요.`);
      else if (!server.agents.length) setNotice("에이전트 설정이 아직 서버에 없습니다. 변경 저장을 누르면 서버에 보관되고 연결 상담방의 세무사 AI 가 씁니다.");
    }).catch(() => { if (alive) setError("서버의 에이전트 설정을 불러오지 못했습니다. 브라우저에 저장된 설정을 보여 줍니다."); });
    return () => { alive = false; };
  }, [initial.agents]);
  const requested = search.get("agent");
  const agent = requested ? agents.find((item) => item.id === requested) : agents[0];
  const dirty = snapshot(agents, roomAgentId) !== saved;
  const unsaved = dirty || Object.keys(contributionEdits).length > 0;
  const preview = (agent && previews[agent.id]) || emptyPreview;
  function setPreview(next: PreviewState) { if (agent) setPreviews((items) => ({ ...items, [agent.id]: next })); }
  useEffect(() => {
    if (!unsaved) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [unsaved]);
  function select(id: string) { router.push(selectAgentHref(path, search.toString(), id), { scroll: false }); }
  function update(next: Agent) { setAgents((items) => items.map((item) => item.id === next.id ? { ...next, practice: next.practice ?? item.practice } : item)); setNotice(""); }
  function add(copy = false) {
    if (agents.length >= 30 || (copy && !agent)) return;
    const next = copy && agent ? { ...structuredClone(agent), id: crypto.randomUUID(), name: `${agent.name.slice(0, 90)} 사본` } : { ...createAgent(owner), practice: createPractice() };
    setAgents((items) => [...items, next]); select(next.id); setNotice("");
  }
  function save() {
    if (locked) return;
    if (agents.some((item) => !item.name.trim())) { setError("에이전트 이름을 입력한 뒤 저장해 주세요."); return; }
    try { saveAgents(window.localStorage, owner, agents); }
    catch { setError("저장하지 못했습니다. 입력 내용은 유지됩니다. 저장 공간과 입력 길이를 확인하고 다시 저장해 주세요."); return; }
    if (!expertServerSync) { setSaved(snapshot(agents, roomAgentId)); setPersisted(true); setError(""); setNotice("이 브라우저에 변경 사항을 저장했습니다."); return; }
    const snap = snapshot(agents, roomAgentId);
    setNotice("서버에 저장하는 중…"); setError("");
    saveServerAgents(agents, roomAgentId)
      .then(() => { setSaved(snap); setPersisted(true); setNotice("서버에 저장했습니다. 연결 상담방의 세무사 AI 가 이 원칙·확인 질문을 씁니다."); })
      .catch((e) => { setNotice(""); setError(`서버에 저장하지 못했습니다(브라우저에는 저장됨): ${e instanceof Error ? e.message : "요청 실패"}`); });
  }
  // Prototype teaching commits locally. Live teaching saves a KB3 draft through its controller.
  function commit(next: PracticeAgent) {
    if (expertServerSync || locked) return false;
    const items = agents.map((item) => item.id === next.id ? next : item);
    if (items.some((item) => !item.name.trim())) { setError("에이전트 이름을 입력한 뒤 저장해 주세요."); return false; }
    try { saveAgents(window.localStorage, owner, items); setAgents(items); setSaved(snapshot(items, roomAgentId)); setPersisted(true); setError(""); setNotice("이 브라우저에 에이전트 변경 사항을 저장했습니다."); return true; }
    catch { setError("저장하지 못했습니다. 입력 내용은 유지됩니다. 저장 공간과 입력 길이를 확인하고 다시 저장해 주세요."); return false; }
  }
  function setRoomAgent(id: string) { setRoomAgentId(id); setNotice(""); }
  function recover() { setLocked(false); setError(""); setNotice("샘플을 열었습니다. 변경 저장을 누르면 이전 저장 데이터를 이 샘플로 대체합니다."); }
  return <Context.Provider value={{ owner, expertName, agents, agent, dirty, persisted, locked, error, notice, update, select, add, save, commit, contributionEdits, setContributionEdit, recover, preview, setPreview, roomAgentId, setRoomAgent }}>{children}</Context.Provider>;
}
function snapshot(agents: Agent[], roomAgentId: string | undefined) { return JSON.stringify({ agents, roomAgentId: roomAgentId ?? null }); }
/** 서버에만 있는 답변 사례(다른 브라우저에서 가르쳤거나 변경 저장 전에 닫음, 10/6 발견 1)를 그 에이전트의 지식 모음에 넣는다. */
function mergeServerCases(agents: PracticeAgent[], cases: ServerExpertCase[]): { agents: PracticeAgent[]; added: number } {
  let added = 0;
  const next = agents.map((agent) => {
    const missing = cases.filter((c) => c.agentId === agent.id && !agent.practice.cases.some((k) => k.id === c.localId));
    if (!missing.length) return agent;
    added += missing.length;
    const imported: KnowledgeCase[] = missing.map((c) => ({ id: c.localId, title: c.title.slice(0, 100), facts: c.facts, judgment: c.judgment, conclusion: c.conclusion, exceptions: c.exceptions, keywords: c.keywords.slice(0, 500), enabled: true, priority: "standard", origin: "expert" }));
    return { ...agent, practice: { ...agent.practice, cases: [...agent.practice.cases, ...imported].slice(0, 100) } };
  });
  return { agents: next, added };
}
export function LibraryFeedback() {
  const { error, notice, locked, recover } = useAgentLibrary();
  return error || notice ? <div role={error ? "alert" : "status"} className={error ? styles.error : styles.notice}>{error || notice}{locked && <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => window.location.reload()}>다시 불러오기</button><button type="button" className={styles.secondary} onClick={recover}>샘플로 대체 준비</button></div>}</div> : null;
}
export function MissingAgent() {
  const { agents, select } = useAgentLibrary();
  return <section className="p-6" role="alert"><h1>에이전트를 찾을 수 없습니다</h1><p>현재 전문가 계정에 없는 에이전트입니다. 내 에이전트를 선택해 주세요.</p><button className={styles.secondary} type="button" onClick={() => select(agents[0].id)}>내 에이전트 열기</button></section>;
}
