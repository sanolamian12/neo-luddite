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
