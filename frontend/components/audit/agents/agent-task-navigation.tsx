"use client";

import { usePathname, useRouter } from "next/navigation";
import { useSidebar } from "@/components/ui/sidebar";
import { agentHref, agentTasks, agentTaskLabels, taskFromPath } from "@/lib/agent-navigation";
import styles from "./agent-practice.module.css";

/** The sidebar owns desktop navigation; hidden-sidebar layouts retain the same agent-only destinations. */
export function AgentTaskNavigation({ agentId }: { agentId: string }) {
  const { open, isMobile } = useSidebar();
  const router = useRouter();
  const task = taskFromPath(usePathname());
  if ((open && !isMobile) || !task) return null;
  return <nav className={styles.taskLocation} aria-label="에이전트 작업"><label htmlFor="agent-task">현재 작업</label><select id="agent-task" value={task} onChange={(event) => router.push(agentHref(event.target.value as typeof agentTasks[number], agentId), { scroll: false })}>{agentTasks.map((id) => <option key={id} value={id}>{agentTaskLabels[id]}</option>)}</select></nav>;
}
