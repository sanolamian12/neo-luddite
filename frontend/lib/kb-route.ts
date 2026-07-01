/**
 * KB path ↔ URL 변환 헬퍼.
 *
 * - path: "직업군/병의원/차량유지비"
 * - URL : "/audit/knowledge/직업군/병의원/차량유지비"
 *   (브라우저는 한글을 자동 인코딩하고, Next 의 catch-all 파라미터는 자동 디코딩)
 */

export const KB_BASE = "/audit/knowledge" as const;
export const KB_EDIT_BASE = "/audit/knowledge/edit" as const;

function encodePath(path: string): string {
  return path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

export function kbHrefForPath(path: string): string {
  if (!path) return KB_BASE;
  return `${KB_BASE}/${encodePath(path)}`;
}

export function kbEditHrefForPath(path: string): string {
  return `${KB_EDIT_BASE}/${encodePath(path)}`;
}

export function pathFromSegments(
  segments: string[] | undefined,
): string | null {
  if (!segments || segments.length === 0) return null;
  return segments.join("/");
}
