"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Check, ChevronDown, ShieldCheck, UserRound } from "lucide-react";
import { expert, finishReply, nextDemoLine, preparedLesson, restoreCheckpoint, sceneIds, sceneLabels, scenePath, script, type Scene } from "@/lib/demo/domain";
import { demoActs, demoNavigation } from "@/lib/demo/navigation";
import { ExpertAvatar } from "@/components/expert/expert-card";
import { CustomerAvatar } from "./avatars";
import { DemoLink, useDemo } from "./runtime";
import css from "./presenter.module.css";

export function DemoPresenter() {
  const demo = useDemo();
  const path = usePathname(), router = useRouter(), search = useSearchParams();
  const [checkpoint, setCheckpoint] = useState<Scene>("A1");
  if (!demo) return null;
  const { run, act } = demo;
  const flow = demoNavigation(run, path, search.get("common") === "1");
  const line = nextDemoLine(run, path.includes("/consultations") ? "expert" : "customer");
  const canFill = ((path.includes("/chat/") || path.includes("/consultations")) && !!line) || search.get("common") === "1" || (path.includes("/teach") && !!run.agent.practice.learning?.draft);
  const nextRole = flow.next ? flow.next.href.startsWith("/admin/") ? "admin" : flow.next.href.startsWith("/audit/") ? "expert" : "customer" : null;
  const changingRole = nextRole && nextRole !== flow.role;
  const roleNames: Record<string, string> = { customer: "고객", expert: "세무사", admin: "운영자" };
  const displayedExpert = path.includes("/ledger") ? run.experts.find(item => item.auditorId === search.get("author")) ?? expert(run) : expert(run);
  const names = { customer: "상담하는 고객", expert: run.expertId ? displayedExpert.displayName : "세무사 선택 전", admin: "공통 지식 운영자" };

  function restore() {
    if (!window.confirm("현재 데모를 선택한 장면의 준비된 상태로 되돌릴까요? 다른 작업은 유지됩니다.")) return;
    try { const next = demo!.transact(old => restoreCheckpoint(old, checkpoint)); router.push(scenePath(next, checkpoint)); }
    catch { /* Runtime reports failure. */ }
  }
  function fill() {
    if (search.get("common") === "1") { act(old => ({ ...old, commonDraft: script.probe })); return; }
    if (path.includes("/teach")) { act(preparedLesson); return; }
    if (line) act(old => ({ ...old, [path.includes("/consultations") ? "expertDraft" : "customerDraft"]: line.text }));
  }

  return <section className={css.presenter} aria-label="데모 진행 안내">
    <div className={css.switchRow}>
      <span className={css.switchLabel}>화면 전환</span>
      <nav className={css.roles} aria-label="데모 참여자 화면 전환">
        {flow.roles.map(role => <DemoLink key={role.id} href={role.href} className={css.role} aria-label={role.label} aria-current={flow.role === role.id ? "page" : undefined} data-role={role.id}>
          <span className={css.avatar} aria-hidden="true">{role.id === "customer" ? <CustomerAvatar /> : role.id === "expert" ? run.expertId ? <ExpertAvatar expert={displayedExpert} className={css.portrait} /> : <UserRound size={21} /> : <ShieldCheck size={21} />}</span>
          <span className={css.roleText}><strong>{role.label}</strong><small>{names[role.id as keyof typeof names]}</small></span>
          {flow.role === role.id && <Check size={14} className={css.selected} aria-hidden="true" />}
        </DemoLink>)}
      </nav>
    </div>
    <details className={css.flow} key={path + ":" + (search.get("common") ?? "")}>
      <summary aria-label="전체 흐름 및 발표 도구 열기">
        <ol className={css.steps} aria-label="데모의 세 가지 막">
          {demoActs.map((item, index) => <li key={item.id} aria-current={index === flow.actIndex ? "step" : undefined} data-complete={flow.completedActs[index]}>
            <span className={css.stepNumber}>{flow.completedActs[index] && index !== flow.actIndex ? <Check size={12} aria-label="완료" /> : index + 1}</span><span>{item.title}</span>
            {index < 2 && <ArrowRight size={12} className={css.connector} aria-hidden="true" />}
          </li>)}
        </ol>
        <span className={css.expandLabel}>전체 흐름</span><ChevronDown size={16} className={css.chevron} aria-hidden="true" />
        <span className="sr-only">발표 도구 열기</span>
      </summary>
      <div className={css.expanded}>
        <p className={css.explanation}>화면을 바꿔도 같은 상담과 작업이 이어집니다. 현재 화면은 위에서, 다음 장면은 아래 안내에서 선택하세요.</p>
        <div className={css.actColumns}>{demoActs.map((item, index) => <section key={item.id}>
          <h2>{index + 1}막 · {item.title}<span>{flow.completedActs[index] ? "완료" : index === flow.actIndex ? "진행 중" : "예정"}</span></h2>
          <p>{item.description}</p>
          <ol>{item.scenes.map(scene => <li key={scene} aria-current={scene === flow.scene ? "step" : undefined}>{sceneLabels[scene]}{scene === flow.scene && <span>현재 화면</span>}</li>)}</ol>
        </section>)}</div>
        <details className={css.tools}><summary>장면 복원 · 발표 보조 도구</summary><div>
          {canFill && <button type="button" onClick={fill}>예시 문장 넣기</button>}
          {run.pending && <button type="button" onClick={() => act(old => finishReply(old, old.pending?.id ?? ""))}>대기 건너뛰기</button>}
          <label>체크포인트<select value={checkpoint} onChange={event => setCheckpoint(event.target.value as Scene)}>{sceneIds.map(scene => <option key={scene} value={scene}>{scene} · {sceneLabels[scene]}</option>)}</select></label>
          <button type="button" onClick={restore}>선택 장면 복원</button><a href="/demo">데모 종료</a>
          <p>장면 복원은 현재 데모를 준비된 예시로 바꿉니다. 예시 입력 후 전송·반영은 화면의 버튼으로 진행합니다.</p>
        </div></details>
      </div>
    </details>
    <div className={css.scene} data-handoff={!!changingRole}>
      <div className={css.sceneCopy}><p><span>{changingRole ? "다음 참여자" : "지금"}</span><strong>{changingRole ? `${roleNames[flow.role]} → ${roleNames[nextRole]}` : sceneLabels[flow.scene]}</strong></p>{changingRole && <small>{nextRole === "admin" ? "전문가의 제안이 도착했어요. 승인할 내용을 확인해 주세요." : nextRole === "expert" && flow.scene === "C1" ? "승인이 반영됐어요. 작성자의 크레딧을 확인해 주세요." : nextRole === "expert" ? "같은 상담이 이어집니다. 세무사의 화면으로 이동해 주세요." : "고객의 화면에서 달라진 답변을 확인해 주세요."}</small>}</div>
      {flow.next ? <DemoLink className={css.next} href={flow.next.href}>{flow.next.label}<ArrowRight size={16} aria-hidden="true" /></DemoLink> : <span className={css.sceneHint}>{run.pending ? "AI의 답변이 이어지고 있습니다" : flow.scene === "A1" ? "아래 문장 넣기로 상담을 시작하세요" : "현재 화면에서 이어서 진행하세요"}</span>}
    </div>
  </section>;
}
