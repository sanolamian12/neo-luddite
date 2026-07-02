"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * 브라우저용 Supabase 클라이언트 — anon key + RLS (마스터설계 §3-2).
 *
 * services/*.ts 가 Zustand 대신 이 클라이언트로 읽고 쓴다 (시그니처 불변, §3-3).
 * 서버 컴포넌트/route handler 에서 쓰려면 별도 server client 가 필요하지만,
 * 현행 services 는 모두 "use client" 라 브라우저 클라이언트로 충분.
 *
 * RLS 가 역할 게이팅을 담당하므로 anon key 노출은 설계상 안전(서비스 롤 키는
 * 절대 프론트에 두지 않음 — 그것은 Python 백엔드 전용, §3-2).
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let _client: SupabaseClient | null = null;

/** 지연 초기화 싱글턴. 환경변수 미설정 시 명확히 실패. */
export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase 환경변수 미설정: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (frontend/.env.local 확인)",
    );
  }
  _client = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return _client;
}

/** 환경변수가 갖춰졌는지 — 서비스가 Supabase/Zustand 폴백을 고를 때 사용. */
export const isSupabaseConfigured = Boolean(url && anonKey);
