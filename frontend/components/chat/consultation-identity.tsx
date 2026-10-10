"use client";

import Image from "next/image";
import { useState } from "react";
import { BookOpenCheck, MessageCircle, ScanLine } from "lucide-react";
import css from "./consultation-identity.module.css";

export function TaxAgentAvatar({ size = "default" }: { size?: "small" | "default" | "large" }) {
  const [failed, setFailed] = useState(false);
  return <span className={css.avatar} data-size={size} aria-hidden="true">
    {failed ? <BookOpenCheck /> : <Image src="/brand/tax-assistant.png" width={96} height={96} sizes={size === "large" ? "76px" : size === "small" ? "32px" : "44px"} alt="" onError={() => setFailed(true)} />}
    <small>AI</small>
  </span>;
}

export function SpeakerBadge({ human = false }: { human?: boolean }) {
  const Icon = human ? MessageCircle : ScanLine;
  return <span className={css.badge} data-human={human}><Icon size={12} aria-hidden="true" />{human ? "세무사 직접 답변" : "AI 안내"}</span>;
}
