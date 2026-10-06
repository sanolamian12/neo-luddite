"use client";

/**
 * 세무사 사례 서버 연동 (0043, 2026-10-06) — 스튜디오의 답변 사례를 KB3(kb3_expert)에 올린다.
 * live 에서만 켠다(프로토타입은 지금처럼 브라우저 저장만). 확인 질문·운영 원칙은 에이전트 설정째 expert_agents(0044,
 * services/expert-agents.ts)에 저장되어 3자 방 세무사 AI 의 프롬프트가 된다.
 *
 * 상태: 서버 미저장 → 초안(답변 미반영) → 게시(내 에이전트 = 나에게 연결된 대화) → 공용 KB 승인 대기 → 공용 KB(모든 상담).
 */

import { useEffect, useState } from "react";
import { create } from "zustand";
import { CloudUpload, Eye, EyeOff, Play, Send } from "lucide-react";
import { isPrototype } from "@/lib/data-mode";
import type { KnowledgeCase } from "@/lib/agent-practice";
import {
  caseStatusLabel, listMyCases, previewAgent, saveCase, setPublished, shareCases,
  type PreviewResponse, type ServerExpertCase,
} from "@/services/expert-kb3";
import styles from "./agent-practice.module.css";

export const expertServerSync = !isPrototype;

const key = (agentId: string, localId: string) => `${agentId}\u0000${localId}`;

interface CaseStore {
  cases: Record<string, ServerExpertCase>;
  loaded: boolean;
  error: string;
  load: () => Promise<void>;
  put: (c: ServerExpertCase) => void;
}

export const useServerCases = create<CaseStore>((set) => ({
  cases: {},
  loaded: false,
  error: "",
  load: async () => {
    try {
      const list = await listMyCases();
      set({ cases: Object.fromEntries(list.map((c) => [key(c.agentId, c.localId), c])), loaded: true, error: "" });
    } catch (e) {
      set({ loaded: true, error: e instanceof Error ? e.message : "서버 사례를 불러오지 못했습니다" });
    }
  },
  put: (c) => set((s) => ({ cases: { ...s.cases, [key(c.agentId, c.localId)]: c } })),
}));

export function useServerCase(agentId: string, localId: string): ServerExpertCase | undefined {
  const { cases, loaded, load } = useServerCases();
  useEffect(() => { if (expertServerSync && !loaded) void load(); }, [loaded, load]);
  return cases[key(agentId, localId)];
}

type CaseFields = Pick<KnowledgeCase, "id" | "title" | "facts" | "judgment" | "conclusion" | "exceptions" | "keywords">;

/** 화면의 사례 → 서버 초안. '검토한 지식 반영'과 지식 모음 '서버에 저장'이 같이 쓴다. */
export async function saveCaseToServer(agentId: string, entry: CaseFields): Promise<ServerExpertCase> {
  const c = await saveCase({
    agentId, localId: entry.id, title: entry.title.trim(), facts: entry.facts.trim(), judgment: entry.judgment.trim(),
    conclusion: entry.conclusion.trim(), exceptions: entry.exceptions.trim(), keywords: entry.keywords.trim(),
  });
  useServerCases.getState().put(c);
  return c;
}

function sameAsServer(entry: CaseFields, c: ServerExpertCase | undefined): boolean {
  if (!c) return false;
  return (["title", "facts", "judgment", "conclusion", "exceptions", "keywords"] as const)
    .every((k) => entry[k].trim() === (c[k] ?? "").trim());
}

/** 지식 모음 상세 — 서버 상태와 저장·게시·내리기. */
export function ServerCasePanel({ agentId, entry }: { agentId: string; entry: KnowledgeCase }) {
  const server = useServerCase(agentId, entry.id);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  if (!expertServerSync) return null;
  const complete = [entry.title, entry.facts, entry.judgment, entry.conclusion].every((v) => v.trim());
  const synced = sameAsServer(entry, server);
  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true); setError(""); setMessage("");
    try { await fn(); setMessage(label); } catch (e) { setError(e instanceof Error ? e.message : "요청 실패"); }
    finally { setBusy(false); }
  }
  return <div className={styles.contextNote} aria-label="RAG 반영 상태">
    <strong>RAG 반영 · {caseStatusLabel(server)}</strong>
    <p>{!server ? "서버에 저장하면 초안이 됩니다. 게시하면 나에게 연결된 상담의 AI 답변에 쓰입니다."
      : !synced ? "화면 내용이 서버와 다릅니다. 다시 저장하면 초안으로 돌아가고, 게시·공용 공유도 다시 해야 합니다."
      : server.publishState === "draft" ? "초안은 답변에 쓰이지 않습니다. 실제 AI 시험칸에서는 초안까지 참고합니다."
      : "공용 KB 로 보내려면 목록에서 골라 '공용 KB 로 보내기'를 누르세요. 관리자가 승인하면 모든 상담에 쓰입니다."}</p>
    <div className={styles.actions}>
      {(!server || !synced) && <button type="button" className={styles.secondary} disabled={busy || !complete}
        onClick={() => run("서버에 초안으로 저장했습니다.", () => saveCaseToServer(agentId, entry))}><CloudUpload size={15} />서버에 저장</button>}
      {server && synced && server.publishState === "draft" && <button type="button" className={styles.primary} disabled={busy}
        onClick={() => run("게시했습니다 — 내 에이전트 답변에 반영됩니다.", async () => useServerCases.getState().put(await setPublished(server.id, true)))}><Eye size={15} />게시</button>}
      {server && server.publishState === "published" && <button type="button" className={styles.secondary} disabled={busy}
        onClick={() => run("게시를 내렸습니다 — 공용 공유도 해제됩니다.", async () => useServerCases.getState().put(await setPublished(server.id, false)))}><EyeOff size={15} />내리기</button>}
    </div>
    {!complete && <p className={styles.hint}>사례 이름·사실·판단·결론을 채워야 저장할 수 있습니다.</p>}
    {message && <p role="status" className={styles.hint}>{message}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </div>;
}

/** 지식 모음 목록 — 고른 사례를 공용 KB 로 보낸다(게시된 것만). */
export function ShareBar({ agentId, selected, onDone }: { agentId: string; selected: string[]; onDone: () => void }) {
  const { cases } = useServerCases();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (!expertServerSync) return null;
  const picked = selected.map((id) => cases[key(agentId, id)]);
  const ready = picked.filter((c): c is ServerExpertCase => !!c && c.publishState === "published" && c.shareState !== "pending" && c.shareState !== "approved");
  async function send() {
    setBusy(true); setMessage("");
    try {
      const out = await shareCases(ready.map((c) => c.id));
      out.forEach((c) => useServerCases.getState().put(c));
      setMessage(`${out.length}건을 공용 KB 승인 대기로 보냈습니다. 관리자가 승인하면 모든 상담에 쓰이고 크레딧이 기록됩니다.`);
      onDone();
    } catch (e) { setMessage(e instanceof Error ? e.message : "요청 실패"); }
    finally { setBusy(false); }
  }
  return <div className={styles.listHead}>
    <span>{selected.length ? `${selected.length}개 선택 · 보낼 수 있는 것 ${ready.length}개(게시된 사례만)` : "공용 KB 로 보낼 사례를 체크하세요"}</span>
    <button type="button" className={styles.textButton} disabled={busy || !ready.length} onClick={send}><Send size={14} />공용 KB 로 보내기</button>
    {message && <p role="status" className={styles.hint}>{message}</p>}
  </div>;
}

const CORPUS_LABEL: Record<string, string> = {
  kb3_expert: "세무사 사례", kb3_trib: "심판례", kb3_qna: "국세청 해석", kb3_prec: "판례",
};

/** 실제 AI 시험칸 — 실제 챗 파이프라인 + 내 사례(초안 포함) + 공용 KB3. */
export function RealPreview({ initialQuery = "" }: { initialQuery?: string }) {
  const [text, setText] = useState(initialQuery);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState("");
  if (!expertServerSync) return null;
  async function run() {
    setBusy(true); setError(""); setResult(null);
    try { setResult(await previewAgent(text.trim())); } catch (e) { setError(e instanceof Error ? e.message : "요청 실패"); }
    finally { setBusy(false); }
  }
  const used = (result?.meta.ragPassages ?? []).filter((p) => p.rank !== null);
  return <section className={styles.paper} aria-label="실제 AI 시험">
    <div className={styles.panelHead}><h3>실제 AI 로 시험하기</h3></div>
    <p className={styles.hint}>실제 상담 AI(Upstage)에 질문합니다. 내가 가르친 사례(초안 포함)와 공용 KB 를 함께 찾아 답합니다. 아래 규칙 시뮬레이션과 별개입니다.</p>
    <div className={styles.form}>
      <label className={styles.field}>고객 질문<textarea rows={3} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} placeholder="예: 개원 전에 한 인테리어 공사비는 어떻게 처리하나요?" /></label>
      <div className={styles.actions}><button type="button" className={styles.primary} disabled={busy || !text.trim()} onClick={run}><Play size={15} />{busy ? "답변 생성 중… (최대 1~2분)" : "답변 받기"}</button></div>
    </div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {result && <>
      <div className={styles.messages}>{result.message.segments.map((s) => <p key={s.id} className={styles.message}>{s.text}</p>)}</div>
      <p className={styles.hint}>참고한 근거 {used.length}건{used.length ? ": " + used.map((p) => CORPUS_LABEL[p.corpus] ?? p.corpus).join(" · ") : ""}{used.some((p) => p.corpus === "kb3_expert") ? " — 내가 가르친 사례가 쓰였습니다." : ""}</p>
    </>}
  </section>;
}
