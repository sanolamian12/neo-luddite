import Link from "next/link";
import { notFound } from "next/navigation";
import { AgentStudio } from "@/components/audit/agents/agent-studio";
import { isPrototype } from "@/lib/data-mode";

export default function AdvancedAgentsPage() {
  if (!isPrototype) notFound();
  return <><div className="flex flex-wrap items-center gap-3 px-6 pt-4 text-sm"><Link href="/audit/agents" className="underline underline-offset-4">← 내 에이전트로</Link><p>고급 모델·연결 설정 · 지식 모음과 별도로 실행되는 그래프 시뮬레이션입니다.</p></div><AgentStudio /></>;
}
