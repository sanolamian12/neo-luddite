"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { finishReply, preparedLesson, restoreCheckpoint, sceneIds, sceneLabels, scenePath, script, type Scene } from "@/lib/demo/domain";
import { DemoLink, useDemo } from "./runtime";
import css from "./demo.module.css";
export function DemoPresenter() {
  const demo = useDemo(); const path = usePathname(), router = useRouter(), search = useSearchParams(); const [checkpoint, setCheckpoint] = useState<Scene>("A1");
  if (!demo) return null;
  const { run, act } = demo;
  const canFill = path.includes("/chat/") || path.includes("/consultations") || (path.includes("/teach") && !!run.agent.practice.learning?.draft);
  const current = search.get("common") === "1" ? "C5" : path.includes("/teach") ? run.agent.practice.learning?.draft ? "B3" : "B2" : path.includes("/preview") ? "B4" : path.includes("/contributions") && !path.includes("knowledge") ? "B5" : path.includes("/batches") ? "C3" : path.includes("knowledge-contributions") ? "C1" : path.includes("ledger") ? "C4" : run.scene;
  const applied = run.agent.practice.cases.some((item) => item.id === run.agent.practice.learning?.draft?.id);
  const next: Scene | null = path.includes("/consultations") && run.completed ? "B1" : path.includes("/teach") && applied ? "B4" : path.includes("/preview") && applied ? "B5" : current === "B5" && run.board.entries.some((item) => item.author.id === run.agent.owner && item.status === "pending") ? "C1" : current === "C1" && run.board.entries.some((item) => item.status === "approved") ? "C2" : current === "C3" && run.batches.at(-1)?.status === "complete" ? "C4" : current === "C4" ? "C5" : path.includes("/chat/") && run.requested ? "A6" : null;
  function restore() { if (!window.confirm("현재 데모를 선택한 장면의 준비된 상태로 되돌릴까요? 다른 작업은 유지됩니다.")) return; try { const next = demo!.transact((old) => restoreCheckpoint(old, checkpoint)); router.push(scenePath(next, checkpoint)); } catch { /* Runtime reports failure. */ } }
  function fill() {
    if (search.get("common") === "1") { act((old) => ({ ...old, commonDraft: script.probe })); return; }
    if (path.includes("/teach")) { act(preparedLesson); return; }
    if (path.includes("/consultations")) { act((old) => ({ ...old, expertDraft: script.human })); return; }
    act((old) => ({ ...old, customerDraft: !old.messages.length ? script.opening : !old.recommended ? script.facts : old.expertId ? old.messages.some((message) => message.author === "expert_ai") ? script.missing : script.followup : script.facts }));
  }
  return <details className={css.bar}><summary><strong>데모</strong><span>{sceneLabels[current]}</span><span className={css.note}>발표 도구 열기</span></summary><div className={css.barContent}>
    <DemoLink href={`/chat/clinic?c=${run.conversationId}`}>고객 화면</DemoLink><DemoLink href="/audit/consultations?kind=participation">세무사 화면</DemoLink><DemoLink href="/admin/knowledge-contributions">운영자 화면</DemoLink>
    {next && <DemoLink href={scenePath(run, next)}>다음: {sceneLabels[next]}</DemoLink>}
    {canFill && <button onClick={fill}>예시 문장 넣기</button>}{run.pending && <button onClick={() => act((old) => finishReply(old, old.pending?.id ?? ""))}>대기 건너뛰기</button>}
    <label>체크포인트<select value={checkpoint} onChange={(event) => setCheckpoint(event.target.value as Scene)}>{sceneIds.map((scene) => <option key={scene} value={scene}>{scene} · {sceneLabels[scene]}</option>)}</select></label><button onClick={restore}>선택 장면 복원</button><a href="/demo">데모 종료</a>
    <span className={css.note}>예시 입력 후 전송·반영은 화면의 버튼으로 진행합니다.</span>
  </div></details>;
}
