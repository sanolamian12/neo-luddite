import type { TaskStatus, AuditStatus, PoolStatus } from "./poc-schema";

export function formatDate(ts: number | undefined | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function formatDateTime(ts: number | undefined | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${formatDate(ts)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 남은 시간을 휴먼-readable 로. */
export function formatRemaining(ts: number | undefined | null, now: number = Date.now()): string {
  if (!ts) return "—";
  const diff = ts - now;
  if (diff <= 0) return "마감됨";
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  if (d > 0) return `D-${d}`;
  if (h > 0) return `${h}시간`;
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return `${m}분`;
}

/**
 * 마감이 지났는데 아직 닫히지 않은 Task (§12 #3).
 * 기준은 **마감일 경과만** — 픽업·진행 중 검수가 있어도 지난 것은 지난 것이다(사용자 결정 2026-09-23).
 * `now` 를 인자로 받는 것은 `formatRemaining` 과 같은 이유(렌더 중 직접 `Date.now()` 금지).
 */
export function isOverdueTask(
  task: { status: TaskStatus; deadline: number },
  now: number = Date.now(),
): boolean {
  return task.status !== "closed" && task.deadline < now;
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  open: "모집중",
  full: "정원마감",
  in_progress: "진행중",
  closed: "종료",
};

export const AUDIT_STATUS_LABEL: Record<AuditStatus, string> = {
  draft: "작성중",
  submitted: "제출됨",
  reviewed: "검수저장",
  finalized: "확정",
  cancelled: "취소",
};

export const POOL_STATUS_LABEL: Record<PoolStatus, string> = {
  new: "신규",
  assigned: "배정됨",
  excluded: "제외",
};

export function taskStatusVariant(status: TaskStatus): "default" | "secondary" | "outline" | "ghost" {
  if (status === "open") return "default";
  if (status === "full" || status === "in_progress") return "secondary";
  return "ghost";
}

export function auditStatusVariant(status: AuditStatus): "default" | "secondary" | "outline" | "ghost" {
  if (status === "draft") return "outline";
  if (status === "submitted") return "default";
  if (status === "reviewed") return "secondary";
  return "ghost";
}
