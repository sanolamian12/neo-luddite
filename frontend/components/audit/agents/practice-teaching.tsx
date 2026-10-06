"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { teachingHref } from "@/lib/agent-navigation";
import { useAgentLibrary } from "./agent-library";
import type { Practice } from "@/lib/agent-practice";
import { ManualTeaching } from "./manual-teaching";
import { SessionTeaching } from "./session-teaching";
import css from "./knowledge-growth.module.css";

type TeachingProps = { practice: Practice; onChange: (practice: Practice) => void; onApply: (practice: Practice) => boolean; onTest: (query: string) => void; onKnowledge: (id?: string) => void; onContribute: (id: string) => void };
export function PracticeTeaching(props: TeachingProps) {
  const router = useRouter(), search = useSearchParams();
  const { agent } = useAgentLibrary();
  const method = search.get("method") === "manual" ? "manual" : "session";
  function setMethod(next: "session" | "manual") { if (agent) router.push(teachingHref(agent.id, next), { scroll: false }); }
  return <><div className={css.teachingModes} aria-label="가르치는 방법"><button type="button" aria-pressed={method === "session"} onClick={() => setMethod("session")}>상담에서 배우기</button><button type="button" aria-pressed={method === "manual"} onClick={() => setMethod("manual")}>직접 사례 들려주기</button></div>{method === "session" ? <SessionTeaching {...props} /> : <ManualTeaching {...props} />}</>;
}
