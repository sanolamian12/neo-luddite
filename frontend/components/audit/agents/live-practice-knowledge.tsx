"use client";

import { useState } from "react";
import { caseStatusLabel } from "@/services/expert-kb3";
import { PracticeKnowledge, type PracticeKnowledgeProps } from "./practice-knowledge";
import { ServerCasePanel, ShareBar, useServerCases } from "./expert-server";
import styles from "./agent-practice.module.css";

export function LivePracticeKnowledge({ agentId, ...props }: Omit<PracticeKnowledgeProps, "onContribute" | "caseTools"> & { agentId: string }) {
  const [selected, setSelected] = useState<string[]>([]);
  const cases = useServerCases((state) => state.cases);
  return <PracticeKnowledge {...props} caseTools={{
    list: <ShareBar agentId={agentId} selected={selected} onDone={() => setSelected([])} />,
    row: (entry) => <label className={`${styles.rowMeta} ${styles.serverChoice}`}><input type="checkbox" aria-label={`${entry.title} 공유 선택`}
      checked={selected.includes(entry.id)} onChange={(event) => setSelected((ids) => event.target.checked ? [...ids, entry.id] : ids.filter((id) => id !== entry.id))} />
      {caseStatusLabel(cases[`${agentId}\u0000${entry.id}`])}
    </label>,
    detail: (entry) => <ServerCasePanel agentId={agentId} entry={entry} />,
  }} />;
}
