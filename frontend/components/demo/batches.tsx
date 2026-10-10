"use client";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { createBatch, incorporateBatch } from "@/lib/demo/domain";
import { contributionStatus } from "@/lib/knowledge-contributions";
import { DemoLink, useDemo, useDemoRouter } from "./runtime";
import { SectionTitle, TextField } from "@/components/audit/agents/practice-ui";
import styles from "@/components/audit/agents/agent-practice.module.css";
import review from "@/components/audit/agents/knowledge-growth.module.css";
import css from "./demo.module.css";
export function DemoBatches() {
  const demo = useDemo(); const router = useDemoRouter(); const params = useParams();
  const [selected, setSelected] = useState<string[]>([]); const [name, setName] = useState("병의원 상담 지식 업데이트 01"); const [issue, setIssue] = useState(""); const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  if (!demo) return <div className="ds-page"><h1>데모에서 업데이트 배치를 확인하세요</h1><DemoLink href="/demo">데모 시작</DemoLink></div>;
  const { run } = demo;
  const batchId = typeof params.batchId === "string" ? params.batchId : undefined;
  const batch = batchId ? run.batches.find((item) => item.id === batchId) : run.batches.at(-1);
  const eligible = run.board.entries.filter((entry) => entry.status === "approved");
  function create() { try { const next = demo!.transact((old) => createBatch(old, selected, name)); router.push(`/admin/knowledge-contributions/batches/${next.batches.at(-1)!.id}`); setIssue(""); } catch (cause) { setIssue(cause instanceof Error ? cause.message : "배치를 확인해 주세요."); } }
  function apply(fail = false) {
    if (!batch || busy) return;
    const id = batch.id;
    if (!demo!.act((old) => ({ ...old, batches: old.batches.map((item) => item.id === id ? { ...item, status: "applying", error: undefined } : item) }))) return;
    setBusy(true); setIssue("");
    timer.current = setTimeout(() => {
      try { demo!.transact((old) => { if (old.batches.find((item) => item.id === id)?.status !== "applying") return old; if (fail) throw new Error("시연용 업데이트 실패 · 이전 지식 버전과 크레딧을 유지했습니다."); return incorporateBatch(old, id); }); }
      catch (cause) { const message = cause instanceof Error ? cause.message : "업데이트에 실패했습니다."; setIssue(message); demo!.act((old) => ({ ...old, batches: old.batches.map((item) => item.id === id ? { ...item, status: "failed", error: message } : item) })); }
      finally { setBusy(false); }
    }, 900);
  }
  return <section className={styles.studio}><div className={`${styles.content} ${review.reviewContent}`}>
    <SectionTitle title="검토된 지식을 하나의 업데이트로" description="검토 완료한 제출본을 묶고, 반영된 버전과 작성자의 기여를 함께 기록합니다." />
    <div className={styles.actions}><DemoLink className={styles.textButton} href="/admin/knowledge-contributions">기여 검토로 돌아가기</DemoLink><strong>활성 공통 지식 · 버전 {run.kbVersion}</strong></div>
    {issue && <p role="alert" className={styles.error}>{issue}</p>}
    {batchId && !batch && <p role="alert">이 배치를 찾을 수 없습니다. 업데이트 목록에서 다시 선택해 주세요.</p>}
    {(!batch || batch.status === "complete") && !batchId && <section className={css.batch}><header><h3>반영할 제안 선택</h3><p className={css.note}>검토 중이거나 수정 요청된 제안은 포함할 수 없습니다.</p></header>
      <div className={css.selectList}>{run.board.entries.filter((entry) => entry.revisions.length).map((entry) => <label key={entry.id} className={css.selectRow} data-selected={selected.includes(entry.id)}><input type="checkbox" aria-label={`${entry.payload.title} 배치에 포함`} disabled={entry.status !== "approved"} checked={selected.includes(entry.id)} onChange={(event) => setSelected((old) => event.target.checked ? [...old, entry.id] : old.filter((id) => id !== entry.id))} /><div><strong>{entry.payload.title}</strong><p>{entry.author.name} · 제출본 {entry.revisions.length} · {contributionStatus[entry.status]}</p></div></label>)}</div>
      {!eligible.length && <p>반영 대기 중인 제안이 없습니다. 먼저 제안을 검토해 주세요.</p>}<TextField label="배치 이름" value={name} onChange={setName} short maxLength={100} /><button className={styles.primary} disabled={!selected.length || !name.trim()} onClick={create}>{selected.length}개 제안으로 배치 만들기</button>
    </section>}
    {batch && <section className={css.batch}><header><h3>{batch.name}</h3><p>버전 {batch.baseVersion} → {batch.targetVersion} · {batch.status === "complete" ? "반영 완료" : batch.status === "applying" ? busy ? "지식 묶음을 검증하고 반영 중…" : "업데이트가 중단되었습니다. 다시 시도해 주세요." : batch.status === "failed" ? "업데이트 실패" : "반영 준비"}</p><p className={css.note}>배치 ID {batch.id} · 포함된 제출본은 고정됩니다.</p></header>
      <table className={`${css.table} ${css.batchTable}`}><caption className="sr-only">배치에 포함된 제출본과 작성자</caption><thead><tr><th scope="col">공유 지식</th><th scope="col">작성자</th><th scope="col">제출본</th></tr></thead><tbody>{batch.items.map((item) => <tr key={item.contributionId}><td>{item.entry.payload.title}<small>{item.contributionId}</small></td><td data-label="작성자">{item.entry.author.name}</td><td data-label="제출본">{item.revision}</td></tr>)}</tbody></table>
      {batch.error && <p role="alert">{batch.error}</p>}<div className={styles.actions}>{batch.status === "complete" ? <><DemoLink className={styles.primary} href="/audit/ledger">작성자의 기여 크레딧 확인</DemoLink><DemoLink className={styles.secondary} href="/chat/clinic?common=1">업데이트된 공통 AI 확인</DemoLink></> : <><button className={styles.primary} disabled={busy} onClick={() => apply()}>{busy ? "반영 중…" : batch.status === "failed" || batch.status === "applying" ? "업데이트 다시 시도" : "공통 지식에 배치 반영"}</button><details><summary className={styles.textButton}>발표용 실패 경로</summary><button className={styles.secondary} disabled={busy} onClick={() => apply(true)}>실패 시연</button></details></>}</div>
      <p className={css.note}>로컬 시연 · 배치 완료 시 제출본당 +1 cr을 기록합니다. 실제 배포나 지급은 실행하지 않습니다.</p>
    </section>}
    {run.batches.length > 0 && <section><h3>업데이트 이력</h3>{run.batches.map((item) => <p key={item.id}><DemoLink href={`/admin/knowledge-contributions/batches/${item.id}`}>{item.name} · 버전 {item.targetVersion} · {item.status === "complete" ? "반영 완료" : "진행 중"}</DemoLink></p>)}</section>}
  </div></section>;
}
