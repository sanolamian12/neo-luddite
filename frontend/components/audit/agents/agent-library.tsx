"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAccountStore } from "@/lib/account-store";
import { createAgent, loadAgents, saveAgents, type Agent } from "@/lib/agent-studio";
import { createPractice, upgradePractice, type Practice } from "@/lib/agent-practice";
import styles from "./agent-practice.module.css";
import { initialPreview, type PreviewState } from "./practice-rehearsal";
import { selectAgentHref } from "@/lib/agent-navigation";
import type { ContributionPayload } from "@/lib/knowledge-contributions";

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
  preview: PreviewState; setPreview: (next: PreviewState) => void;
}
const Context = createContext<Library | null>(null);
const subscribe = () => () => {};
export function AgentLibraryProvider({ children }: { children: ReactNode }) {
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const owner = useAccountStore((state) => state.auditor.id);
  return ready ? <LibraryState key={owner} owner={owner}>{children}</LibraryState> : <p className="p-6" role="status">전문가 워크스페이스를 불러오는 중…</p>;
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
  const [saved, setSaved] = useState(JSON.stringify(initial.agents));
  const [persisted, setPersisted] = useState(initial.persisted);
  const [locked, setLocked] = useState(!!initial.error);
  const [error, setError] = useState(initial.error);
  const [notice, setNotice] = useState("");
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({});
  const [contributionEdits, setContributionEdits] = useState<Record<string, ContributionWorkingCopy>>({});
  function setContributionEdit(id: string, copy?: ContributionWorkingCopy) { setContributionEdits((items) => { const next = { ...items }; if (copy) next[id] = copy; else delete next[id]; return next; }); }
  const [emptyPreview] = useState(initialPreview);
  const requested = search.get("agent");
  const agent = requested ? agents.find((item) => item.id === requested) : agents[0];
  const dirty = JSON.stringify(agents) !== saved;
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
  function persist(items: PracticeAgent[]) {
    if (locked) return false;
    if (items.some((item) => !item.name.trim())) { setError("에이전트 이름을 입력한 뒤 저장해 주세요."); return false; }
    try { saveAgents(window.localStorage, owner, items); setSaved(JSON.stringify(items)); setPersisted(true); setError(""); setNotice("이 브라우저에 에이전트 변경 사항을 저장했습니다."); return true; }
    catch { setError("저장하지 못했습니다. 입력 내용은 유지됩니다. 저장 공간과 입력 길이를 확인하고 다시 저장해 주세요."); return false; }
  }
  function save() { persist(agents); }
  function commit(next: PracticeAgent) { const items = agents.map((item) => item.id === next.id ? next : item); if (!persist(items)) return false; setAgents(items); return true; }
  function recover() { setLocked(false); setError(""); setNotice("샘플을 열었습니다. 변경 저장을 누르면 이전 저장 데이터를 이 샘플로 대체합니다."); }
  return <Context.Provider value={{ owner, expertName, agents, agent, dirty, persisted, locked, error, notice, update, select, add, save, commit, recover, preview, setPreview, contributionEdits, setContributionEdit }}>{children}</Context.Provider>;
}
export function LibraryFeedback() {
  const { error, notice, locked, recover } = useAgentLibrary();
  return error || notice ? <div role={error ? "alert" : "status"} className={error ? styles.error : styles.notice}>{error || notice}{locked && <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => window.location.reload()}>다시 불러오기</button><button type="button" className={styles.secondary} onClick={recover}>샘플로 대체 준비</button></div>}</div> : null;
}
export function MissingAgent() {
  const { agents, select } = useAgentLibrary();
  return <section className="p-6" role="alert"><h1>에이전트를 찾을 수 없습니다</h1><p>현재 전문가 계정에 없는 에이전트입니다. 내 에이전트를 선택해 주세요.</p><button className={styles.secondary} type="button" onClick={() => select(agents[0].id)}>내 에이전트 열기</button></section>;
}
