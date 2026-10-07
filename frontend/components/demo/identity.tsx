"use client";

import { useState } from "react";
import { ArrowRight, Check, ChevronDown, MessageCircle, UserRound } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ExpertAvatar } from "@/components/expert/expert-card";
import { ExpertDirectory } from "@/components/expert/expert-directory";
import { Button } from "@/components/ui/button";
import type { ExpertCard } from "@/lib/poc-schema";
import { expert, selectExpert, type DemoRun } from "@/lib/demo/domain";
import { withDemoPortrait } from "@/lib/demo/expert-identity";
import { useDemo } from "./runtime";
import css from "./conversation.module.css";

export function AgentAvatar({ common = false, large = false }: { common?: boolean; large?: boolean }) {
  return <span className={css.agentAvatar} data-common={common} data-large={large} aria-hidden="true">
    <svg viewBox="0 0 40 40" fill="none"><path d="M20 6C12 6 6 12 6 20s6 14 14 14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /><path d="M20 12c5 0 8 3 8 8s-3 8-8 8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /><circle cx="20" cy="20" r="3" fill="currentColor" /><circle cx="33" cy="8" r="3" fill="currentColor" /></svg>
    {!common && <small>AI</small>}
  </span>;
}

export function CustomerAvatar() { return <span className={css.customerAvatar} aria-label="고객 아바타"><UserRound size={20} strokeWidth={1.6} /></span>; }

export function ExpertProfile({ profile, status }: { profile: ExpertCard; status: string }) {
  const person = withDemoPortrait(profile);
  return <Dialog><DialogTrigger render={<button className={css.expertButton} />} aria-label={`${person.displayName} 정보 보기`}>
    <ExpertAvatar expert={person} className={css.headerPortrait} /><span><strong>{person.displayName}</strong><small><i />{status}</small></span><ChevronDown size={15} />
  </DialogTrigger><DialogContent className={css.profileDialog}>
    <div className={css.profileHero}><ExpertAvatar expert={person} className={css.profilePortrait} /><div><DialogTitle className={css.profileName}>{person.displayName}</DialogTitle><DialogDescription>나의 상담에 함께하는 세무사</DialogDescription><p>상담 경력 {person.yearsExperience}년 · 가상 프로필</p></div></div>
    <section className={css.profileSection}><h3>이렇게 상담합니다</h3><p>{person.bio}</p></section>
    <section className={css.profileSection}><h3>전문 분야</h3><div className={css.specialties}>{person.specialties.map(item => <span key={item}>{item}</span>)}</div></section>
    <section className={css.profileSection}><h3>세무사와 AI가 함께합니다</h3><p>AI가 세무사의 지식과 상담 기준으로 질문을 정리합니다. 직접 검토가 필요한 순간에는 세무사가 이 대화에서 답변합니다.</p></section>
    <p className={css.disclosure}>시연을 위한 가상 인물이며, 프로필 사진은 AI로 생성했습니다.</p>
  </DialogContent></Dialog>;
}

export function ConversationIdentity({ run, expertView }: { run: DemoRun; expertView: boolean }) {
  const person = expert(run);
  const status = run.completed ? "상담 완료" : run.controller === "expert" ? "직접 답변 중" : "대화에 참여 중";
  return <header className={css.identity} data-expert-view={expertView}>
    <div className={css.spaceIdentity}>{expertView ? <CustomerAvatar /> : <AgentAvatar common={!run.expertId} />}<div><h1>{expertView ? "고객과의 상담" : run.expertId ? run.agent.name : "공통 AI"}</h1><p>{expertView ? "고객의 질문을 살펴보고, 필요한 순간 직접 답변하세요." : run.expertId ? "세무사의 지식과 상담 기준으로, 더 깊이 함께합니다." : "나의 상황부터, 차근차근 이야기해 주세요."}</p></div></div>
    {run.expertId && <ExpertProfile profile={person} status={status} />}
  </header>;
}

export function ExpertConnection({ onConnected }: { onConnected: () => void }) {
  const { run, act } = useDemo()!;
  const [open, setOpen] = useState(false), [selected, setSelected] = useState<string | null>(null);
  return <div className={css.recommendation}><div className={css.recommendationHeading}><MessageCircle size={22} /><h3>세무사와 함께 살펴볼까요?</h3></div><p>지금까지의 대화를 이어받아, 세무사의 AI가 더 구체적으로 안내하고 필요한 순간 세무사가 직접 답변합니다.</p>
    <div className={css.recommendationAction}><div className={css.portraitStack}>{run.experts.map(item => <ExpertAvatar key={item.auditorId} expert={withDemoPortrait(item)} className={css.stackPortrait} />)}<span>함께할 세무사 {run.experts.length}명</span></div><Dialog open={open} onOpenChange={setOpen}><DialogTrigger render={<Button />}>세무사 선택하기<ArrowRight size={16} /></DialogTrigger><DialogContent className={css.pickerDialog} showCloseButton={false}>
      <DialogTitle className="sr-only">세무사와 상담 이어가기</DialogTitle><DialogDescription className="sr-only">세무사의 상담 분야와 소개를 확인한 뒤 연결을 확정하세요.</DialogDescription>
      <ExpertDirectory experts={run.experts.map(item => ({ ...withDemoPortrait(item), displayName: item.displayName.replace(/ 세무사$/, "") }))} selectedId={selected} onSelect={setSelected} onClose={() => setOpen(false)} showLikes={false} requestLabel="이 세무사와 연결하기" connectionNote="세무사의 AI와 상담하고, 필요한 순간 직접 검토를 받아요." onRequest={() => { if (selected && act(old => selectExpert(old, selected))) { setOpen(false); onConnected(); } }} onToggleLike={id => act(old => ({ ...old, experts: old.experts.map(item => item.auditorId === id ? { ...item, likedByMe: !item.likedByMe, likeCount: item.likedByMe ? 0 : 1 } : item) }))} likeBusyId={null} canAct />
    </DialogContent></Dialog></div>
  </div>;
}

export function HandoffArrival({ run, animate }: { run: DemoRun; animate: boolean }) {
  return <section className={css.arrival} data-animate={animate} aria-label="세무사의 AI 상담 시작"><div className={css.arrivalPortraits}><ExpertAvatar expert={withDemoPortrait(expert(run))} className={css.arrivalPortrait} /><span className={css.connectionLine} /><AgentAvatar large /></div><h2>{run.agent.name}와<br className={css.mobileBreak} /> 상담을 이어갑니다</h2><p>앞선 대화와 질문을 그대로 이어받았어요.</p><span className={css.contextCarried}><Check size={15} />{expert(run).displayName}도 대화에 함께합니다</span></section>;
}
