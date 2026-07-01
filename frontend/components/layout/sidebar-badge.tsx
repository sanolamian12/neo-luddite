import { cn } from "@/lib/utils";

/** 사이드바 메뉴 항목 우측의 작은 카운트 배지. */
export function SidebarBadge({
  count,
  dot,
  variant = "neutral",
}: {
  count?: number;
  dot?: boolean;
  variant?: "neutral" | "warn";
}) {
  if (count === undefined || count <= 0) return null;
  return (
    <span
      className={cn(
        "ml-auto inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
        variant === "warn"
          ? "bg-sidebar-primary text-sidebar-primary-foreground"
          : "bg-sidebar-accent text-sidebar-accent-foreground",
      )}
      aria-label={`${count} 항목`}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {count}
    </span>
  );
}
