"use client";

import { useId, type RefObject } from "react";
import { ArrowUp } from "lucide-react";
import styles from "./entry-chat.module.css";

export function EntryComposer({ value, onChange, onSend, disabled = false, busy = false, inputRef, embedded = false, placeholder = "궁금한 점을 편하게 적어 주세요…" }: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  busy?: boolean;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  embedded?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  return <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); if (!disabled && !busy && value.trim()) onSend(); }}>
    <label className="sr-only" htmlFor={id}>질문 또는 상황을 입력하세요</label>
    <textarea id={id} ref={inputRef} value={value} rows={embedded ? 3 : 2} maxLength={4000}
      placeholder={placeholder} disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          if (!disabled && !busy && value.trim()) onSend();
        }
      }} />
    <div className={styles.composerActions}>
      <span>{embedded ? "로그인 없이 시작하세요" : "Enter 전송 · Shift + Enter 줄바꿈"}</span>
      <button type="submit" aria-label="질문 보내기" disabled={disabled || busy || !value.trim()}><ArrowUp size={20} /></button>
    </div>
  </form>;
}
