"use client";

import type { Segment } from "@/lib/conversation-schema";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * 감사용 선택 가능 문장(세그먼트). data-segment-id로 앵커링.
 * 상태: hover / selected(파랑 링) / has-feedback(초록 좌측 강조 + 카운트).
 */
export function AuditSegment({
  seg,
  selected,
  feedbackCount,
  onSelect,
}: {
  seg: Segment;
  selected: boolean;
  feedbackCount: number;
  onSelect: (id: string) => void;
}) {
  const hasMeta = Boolean(seg.framework || seg.citations?.length);
  return (
    <p
      data-segment-id={seg.id}
      data-segment-type={seg.type}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => onSelect(seg.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(seg.id);
        }
      }}
      className={cn(
        "cursor-pointer rounded-md px-2 py-1 leading-relaxed outline-none transition",
        "focus-visible:ring-2 focus-visible:ring-brand-blue",
        selected
          ? "bg-brand-blue/15 ring-2 ring-brand-blue"
          : "hover:bg-muted",
        feedbackCount > 0 && "border-l-2 border-brand-green",
      )}
    >
      <span>{seg.text}</span>
      {hasMeta && (
        <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
          {seg.framework && (
            <Badge variant="secondary" className="text-[10px] font-normal">
              {seg.framework}
            </Badge>
          )}
          {seg.citations?.map((c) => (
            <Badge key={c} variant="outline" className="text-[10px] font-normal">
              {c}
            </Badge>
          ))}
        </span>
      )}
      {feedbackCount > 0 && (
        <Badge className="ml-1.5 border-transparent bg-brand-green text-[10px] text-brand-green-foreground">
          피드백 {feedbackCount}
        </Badge>
      )}
    </p>
  );
}
