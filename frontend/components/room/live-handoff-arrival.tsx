"use client";

import Image from "next/image";
import { useState } from "react";
import { ArrowRight, Check, MessagesSquare } from "lucide-react";
import { ExpertAvatar } from "@/components/expert/expert-card";
import { TaxAgentAvatar } from "@/components/chat/consultation-identity";
// 팀장 프로토타입(09519ef) 데모 전환 장면(components/demo/identity.tsx HandoffArrival)의 모양을 그대로 쓴다 — 스타일만 빌려 온다.
import css from "@/components/demo/conversation.module.css";

/** 가상 세무사 사진(/demo/experts/<slug>.png) ↔ 그 세무사 AI 아바타(/demo/avatars/<slug>-ai.png). 없으면 공통 AI 아바타. */
export function agentAvatarFor(avatarUrl?: string): string | null {
  const m = /^\/demo\/experts\/([a-z0-9-]+)\.png$/.exec(avatarUrl ?? "");
  return m ? `/demo/avatars/${m[1]}-ai.png` : null;
}

function AgentPortrait({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <TaxAgentAvatar size="large" />;
  return (
    <span className={css.agentAvatar} data-large="true" aria-hidden="true">
      <Image src={src} alt="" width={96} height={96} sizes="76px" className={css.avatarImage} onError={() => setFailed(true)} />
      <small>AI</small>
    </span>
  );
}

/**
 * 즉시 연결(R3) 직후 방 맨 위의 전환 장면 — 세무사 사진 ─ 연결선 ─ 세무사 AI.
 * 문구는 프로토타입과 같다("○○와 함께하는 상담 / ○○의 AI가 지금부터 상담을 이어갑니다").
 */
export function LiveHandoffArrival({
  expertName,
  avatarUrl,
  avatarColor,
  animate,
}: {
  expertName: string;
  avatarUrl?: string;
  avatarColor?: string;
  animate: boolean;
}) {
  // display_name 은 이름만(화면이 " 세무사"를 붙이는 관례). 이미 붙어 있으면 그대로.
  const base = expertName.trim();
  const name = !base ? "담당 세무사" : base.endsWith("세무사") ? base : `${base} 세무사`;
  return (
    <section className={css.arrival} data-animate={animate} aria-label="세무사의 AI 상담 시작" data-testid="room-handoff-arrival">
      <div className={css.arrivalPortraits}>
        <ExpertAvatar expert={{ displayName: name, avatarUrl, avatarColor }} className={css.arrivalPortrait} />
        <span className={css.connectionLine}><ArrowRight size={18} /></span>
        <AgentPortrait src={agentAvatarFor(avatarUrl)} />
      </div>
      <h2>{name}와<br className={css.mobileBreak} /> 함께하는 상담</h2>
      <p>{name}의 AI가<br className={css.mobileBreak} /> 지금부터 상담을 이어갑니다.</p>
      <div className={css.arrivalFacts}>
        <span><MessagesSquare size={15} />이전 대화 그대로 연결</span>
        <span><Check size={15} />필요할 때 세무사가 직접 답변</span>
      </div>
    </section>
  );
}
