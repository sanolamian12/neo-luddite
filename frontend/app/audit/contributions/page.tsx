import { notFound } from "next/navigation";
import { PracticeContributions } from "@/components/audit/agents/practice-contributions";
import { isPrototype } from "@/lib/data-mode";
import styles from "@/components/audit/agents/agent-practice.module.css";

export default function ContributionsPage() {
  if (!isPrototype) notFound();
  return <section className={styles.studio} aria-label="공통 지식 기여 워크스페이스"><div className={styles.content}><PracticeContributions /></div></section>;
}
