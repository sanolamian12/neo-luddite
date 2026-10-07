"use client";

import Image from "next/image";
import { useState } from "react";
import css from "./conversation.module.css";

const agents: Record<string, string> = {
  "demo-expert-1": "yun-seojin-ai",
  "demo-expert-2": "kim-dohyeon-ai",
  "demo-expert-3": "lee-sumin-ai",
};

function AvatarImage({ src, large = false, fallback }: { src: string; large?: boolean; fallback: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? <span className={css.avatarFallback}>{fallback}</span> : <Image src={src} alt="" width={96} height={96} sizes={large ? "76px" : "44px"} className={css.avatarImage} onError={() => setFailed(true)} />;
}

export function AgentAvatar({ common = false, large = false, expertId }: { common?: boolean; large?: boolean; expertId?: string }) {
  const identity = common || !expertId ? "common-ai" : agents[expertId] ?? "common-ai";
  return <span className={css.agentAvatar} data-common={common || !expertId} data-large={large} data-ai-avatar={identity} aria-hidden="true">
    <AvatarImage key={identity} src={`/demo/avatars/${identity}.png`} large={large} fallback="AI" />
    <small>AI</small>
  </span>;
}

export function CustomerAvatar() {
  return <span className={css.customerAvatar} data-customer-avatar aria-hidden="true"><AvatarImage src="/demo/avatars/customer.png" fallback="고객" /></span>;
}
