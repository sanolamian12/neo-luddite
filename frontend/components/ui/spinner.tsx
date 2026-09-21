import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 동그라미 로딩 스피너. 첫 적재가 Realtime 준비(최대 5초)를 기다리는 동안 "멈춘 것"으로 보이지 않게 한다
 * (sync.ts waitForPostgresReady). 움직임 줄이기 설정이면 회전을 멈추고 문구만 남긴다.
 *
 * - label 이 있으면 스피너 옆에 문구를 붙인다(`불러오는 중…` 등). 없으면 스크린리더용 aria-label 만.
 * - size: sm = 사이드바·버튼 안처럼 좁은 자리, md = 목록·상세 본문.
 */
export function Spinner({
  label,
  size = "md",
  className,
}: {
  label?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={label ?? "불러오는 중"}
      data-slot="spinner"
      className={cn(
        "inline-flex min-w-0 items-center gap-2 text-muted-foreground",
        size === "sm" ? "text-xs" : "text-sm",
        className,
      )}
    >
      <LoaderCircle
        aria-hidden
        className={cn(
          "shrink-0 animate-spin motion-reduce:animate-none",
          size === "sm" ? "size-3.5" : "size-4",
        )}
      />
      {label && <span className="min-w-0 truncate">{label}</span>}
    </span>
  );
}

/** 본문 자리를 채우는 로딩 — 가운데 정렬 블록. */
export function LoadingBlock({ label = "불러오는 중…", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center px-6 py-10", className)}>
      <Spinner label={label} />
    </div>
  );
}
