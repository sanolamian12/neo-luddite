"use client";

import { ArrowUpLeft } from "lucide-react";
import styles from "./entry-chat.module.css";

const prompts = ["리스한 차를 가족도 쓰는데, 비용처리가 될까요?", "거래처와 골프를 친 비용이 궁금해요", "직원 헬스장 회원권도 복지비가 되나요?"];

export function EntryPrompts({ onSelect, disabled }: { onSelect: (text: string) => void; disabled?: boolean }) {
  return <div className={styles.suggestions} aria-label="질문 예시">
    {prompts.map((prompt) => <button key={prompt} type="button" disabled={disabled} onClick={() => onSelect(prompt)}><ArrowUpLeft size={16} />{prompt}</button>)}
  </div>;
}
