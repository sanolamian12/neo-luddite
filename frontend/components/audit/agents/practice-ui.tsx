"use client";

import { useId, type ReactNode } from "react";
import styles from "./agent-practice.module.css";

export function TextField({ label, value, onChange, hint, rows = 3, short = false, maxLength = 6000, required = false }: { label: string; value: string; onChange: (value: string) => void; hint?: string; rows?: number; short?: boolean; maxLength?: number; required?: boolean }) {
  const id = useId();
  const props = { id, value, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value), maxLength, required, "aria-describedby": hint ? `${id}-hint` : undefined };
  return <div className={styles.field}><label htmlFor={id}>{label}{required && <span className={styles.required}> 필수</span>}</label>{short ? <input {...props} /> : <textarea {...props} rows={rows} />}{hint && <p id={`${id}-hint`} className={styles.hint}>{hint}</p>}</div>;
}
export function Toggle({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (value: boolean) => void }) {
  const id = useId();
  return <div className={styles.toggleRow}><div><label htmlFor={id}>{label}</label>{description && <p id={`${id}-hint`}>{description}</p>}</div><input id={id} type="checkbox" role="switch" checked={checked} aria-describedby={description ? `${id}-hint` : undefined} onChange={(event) => onChange(event.target.checked)} /></div>;
}
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className={styles.empty}><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>;
}
export function SectionTitle({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className={styles.sectionTitle}><div><h2 tabIndex={-1} data-task-heading>{title}</h2><p>{description}</p></div>{action}</div>;
}
export function Provenance({ sample }: { sample: boolean }) { return <span className={styles.provenance}>{sample ? "설명용 예시" : "내가 가르친 지식"}</span>; }
