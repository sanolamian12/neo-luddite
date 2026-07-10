"use client";

import { Button } from "@/components/ui/button";

/** 1–5 세그먼트 점수 컨트롤 (버튼 5개). */
export function ScoreControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex flex-col items-start gap-1 md:flex-row md:items-center md:justify-between md:gap-2">
      <span className="text-sm">{label}</span>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <Button
            key={n}
            type="button"
            size="icon-sm"
            variant={value === n ? "default" : "outline"}
            onClick={() => onChange(n)}
            aria-pressed={value === n}
          >
            {n}
          </Button>
        ))}
      </div>
    </div>
  );
}
