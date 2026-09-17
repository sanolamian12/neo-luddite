"use client";

import { getSupabase, isSupabaseConfigured } from "./supabase/client";

/**
 * Seam A 백엔드 호출용 fetch — 쓰기 요청에 Supabase access token 을 붙인다(P6 ①, 2026-09-17).
 *
 * 백엔드는 쓰기 API(챗 제외)의 신원을 요청 본문이 아니라 이 토큰으로 결정한다(backend/api/auth.py).
 * GET 에는 붙이지 않는다 — 읽기는 인증 대상이 아니고, 헤더를 붙이면 매 조회가 CORS preflight 를 탄다.
 * 세션이 없으면(로그아웃·Supabase 미설정) 헤더 없이 보낸다 → 백엔드가 401 로 알려준다.
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || !isSupabaseConfigured) {
    return fetch(input, init);
  }
  const headers = new Headers(init.headers);
  if (!headers.has("Authorization")) {
    try {
      const { data } = await getSupabase().auth.getSession();
      const token = data.session?.access_token;
      if (token) headers.set("Authorization", `Bearer ${token}`);
    } catch {
      // 세션 조회 실패 — 헤더 없이 보내고 서버 응답(401)으로 드러나게 둔다.
    }
  }
  return fetch(input, { ...init, headers });
}
