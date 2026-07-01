"use client";

import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * 단순 마크다운 에디터 — textarea + preview 분할.
 * 툴바·자동완성 없음 (v1 정책). preview 는 자식이 직접 렌더한다.
 * 두 칸 모두 60vh 로 고정하여 preview 의 `overflow-y-auto` 가 실제로 동작한다.
 */
export function MarkdownEditor({
  value,
  onChange,
  preview,
  className,
  textareaClassName,
  previewClassName,
}: {
  value: string;
  onChange: (v: string) => void;
  preview: React.ReactNode;
  className?: string;
  textareaClassName?: string;
  previewClassName?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4",
        className,
      )}
    >
      <div className="flex flex-col">
        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          본문
        </label>
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            "h-[60vh] resize-none font-mono text-sm leading-relaxed",
            textareaClassName,
          )}
          spellCheck={false}
        />
      </div>
      <div className="flex flex-col">
        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          미리보기
        </label>
        <div
          className={cn(
            "kb-prose h-[60vh] overflow-y-auto rounded-md border bg-muted/20 px-4 py-3",
            previewClassName,
          )}
        >
          {preview}
        </div>
      </div>
    </div>
  );
}
