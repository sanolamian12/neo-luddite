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

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  open: "모집중",
  full: "정원마감",
  in_progress: "진행중",
  closed: "종료",
};

export const AUDIT_STATUS_LABEL: Record<AuditStatus, string> = {
  draft: "작성중",
  submitted: "제출됨",
  reviewed: "검수완료",
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
