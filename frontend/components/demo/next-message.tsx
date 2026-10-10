"use client";

import { ArrowDownToLine, Check } from "lucide-react";
import css from "./conversation.module.css";

export function DemoNextMessage({ text, draft, onInsert }: { text: string; draft: string; onInsert: () => void }) {
  if (draft.trim()) return <p className={css.nextLineHint} role="status">{draft === text ? <><Check size={14} />문장을 넣었어요. 수정하거나 전송하세요.</> : "작성한 문장을 전송하거나 지우면 다음 예시를 넣을 수 있어요."}</p>;
  return <aside className={css.nextLine} aria-label="다음 데모 문장">
    <p title={text}><span>예시</span>{text}</p>
    <button type="button" onClick={onInsert}><ArrowDownToLine size={16} />문장 넣기</button>
  </aside>;
}
