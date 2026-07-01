"use client";

import { Plus } from "lucide-react";
import { useReplayStore } from "@/lib/replay-store";

/**
 * 진행 중인 대화를 초기화하고 스타터 화면으로 복귀.
 * 대화가 활성일 때만(메시지 존재) 노출된다.
 */
export function NewChatButton() {
  const hasMessages = useReplayStore((s) => s.visible.length > 0);
  const reset = useReplayStore((s) => s.reset);

  if (!hasMessages) return null;

  return (
    <button
      type="button"
      onClick={() => reset()}
      className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition hover:border-brand-blue hover:bg-muted"
    >
      <Plus className="size-3.5" />새 상담
    </button>
  );
}
