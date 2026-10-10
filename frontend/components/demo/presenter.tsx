"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Check, ChevronDown, ShieldCheck, UserRound, X } from "lucide-react";
import { expert, finishReply, nextDemoLine, preparedLesson, restoreCheckpoint, sceneIds, sceneLabels, scenePath, script, type Scene } from "@/lib/demo/domain";
import { demoActs, demoNavigation } from "@/lib/demo/navigation";
import { ExpertAvatar } from "@/components/expert/expert-card";
import { CustomerAvatar } from "./avatars";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/design-system/theme-toggle";
import { Popover, PopoverTrigger, PopoverPortal, PopoverPositioner, PopoverContent, PopoverClose } from "@/components/ui/popover";
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
  const changingRole = !!nextRole && nextRole !== flow.role;
  const currentAct = demoActs[flow.actIndex];
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
    <div className={css.toolbar}>
      <SidebarTrigger className={css.menu} aria-label="탐색 메뉴 열기/닫기" />
      <nav className={css.roles} aria-label="데모 참여자 화면 전환">
        {flow.roles.map(role => <DemoLink key={role.id} href={role.href} className={css.role} aria-label={role.label} title={`${role.label} · ${names[role.id as keyof typeof names]}`} aria-current={flow.role === role.id ? "page" : undefined}>
          <span className={css.avatar} aria-hidden="true">{role.id === "customer" ? <CustomerAvatar /> : role.id === "expert" ? run.expertId ? <ExpertAvatar expert={displayedExpert} className={css.portrait} /> : <UserRound size={18} /> : <ShieldCheck size={18} />}</span>
          <span>{roleNames[role.id]}</span>
        </DemoLink>)}
      </nav>
      <Popover key={`${path}:${search.get("common")}:${search.get("author")}`}>
        <PopoverTrigger className={css.flowTrigger} aria-label="전체 흐름 및 발표 도구 열기" title={`${flow.actIndex + 1}막 · ${currentAct.title} · ${sceneLabels[flow.scene]}`}>
          <span className={css.flowLabel}>흐름</span><span className={css.progress}>{flow.actIndex + 1}/3</span><span className={css.currentScene}>{currentAct.title} · {sceneLabels[flow.scene]}</span><ChevronDown size={14} aria-hidden="true" />
        </PopoverTrigger>
        <PopoverPortal><PopoverPositioner side="bottom" align="end" sideOffset={8} collisionPadding={12}>
          <PopoverContent className={css.flowPanel} aria-label="데모 전체 흐름 및 발표 도구">
            <header className={css.panelHeader}><div><h2>데모 진행</h2><p>{names[flow.role as keyof typeof names]} · {sceneLabels[flow.scene]}</p></div><ThemeToggle /><PopoverClose className={css.close} aria-label="발표 도구 닫기"><X size={18} /></PopoverClose></header>
            <p className={css.explanation}>화면을 바꿔도 같은 상담과 작업이 이어집니다. 다음 장면은 상단 안내에서 선택하세요.</p>
            <div className={css.actColumns}>{demoActs.map((item, index) => <section key={item.id}>
              <h3>{index + 1}막 · {item.title}<span>{flow.completedActs[index] ? <><Check size={12} />완료</> : index === flow.actIndex ? "진행 중" : "예정"}</span></h3>
              <p>{item.description}</p>
              <ol>{item.scenes.map(scene => <li key={scene} aria-current={scene === flow.scene ? "step" : undefined}>{sceneLabels[scene]}{scene === flow.scene && <span>현재 화면</span>}</li>)}</ol>
            </section>)}</div>
            <details className={css.tools}><summary>장면 복원 · 발표 보조 도구</summary><div>
              {canFill && <PopoverClose onClick={fill}>예시 문장 넣기</PopoverClose>}
              {run.pending && <button type="button" onClick={() => act(old => finishReply(old, old.pending?.id ?? ""))}>대기 건너뛰기</button>}
              <label>체크포인트<select value={checkpoint} onChange={event => setCheckpoint(event.target.value as Scene)}>{sceneIds.map(scene => <option key={scene} value={scene}>{scene} · {sceneLabels[scene]}</option>)}</select></label>
              <button type="button" onClick={restore}>선택 장면 복원</button><a href="/demo">데모 종료</a>
              <p>장면 복원은 현재 데모를 준비된 예시로 바꿉니다. 예시 입력 후 전송·반영은 화면의 버튼으로 진행합니다.</p>
            </div></details>
          </PopoverContent>
        </PopoverPositioner></PopoverPortal>
      </Popover>
      {flow.next && <DemoLink className={css.next} data-handoff={changingRole} href={flow.next.href}>{flow.next.label}<ArrowRight size={16} aria-hidden="true" /></DemoLink>}
    </div>
  </section>;
}
