import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 긴 문자열(ID·해시·UUID 등)을 "앞 head자…뒤 tail자"로 축약.
 * 모바일 좁은 폭에서 ID 오버플로/클리핑을 막는다. 전체값은 title 속성으로 노출 권장.
 * 축약해도 이득이 없을 만큼 짧으면(≤ head+tail+1) 원문 그대로.
 */
export function middleTruncate(s: string | null | undefined, head = 4, tail = 4): string {
  if (!s) return ""
  if (s.length <= head + tail + 1) return s
  return `${s.slice(0, head)}…${s.slice(-tail)}`
}
