"use client";

import { getApiBase as apiBase } from "@/lib/data-mode";
import { apiFetch } from "@/lib/api-fetch";

/**
 * 백엔드 도달 확인 — 관리자 인프라·LLM 화면의 라이브 배지.
 * (옛 RAG 쓰기·KB 조회 서비스 rag.ts 는 옛 검수 흐름 절단 S2 에서 지웠다.)
 */

/** GET /health — Seam A 기동/연결 모델 확인. */
export interface ServiceHealth {
  ok: boolean;
  service: string;
  model: string;
}

export async function getServiceHealth(): Promise<ServiceHealth> {
  const url = new URL("/health", apiBase());
  const res = await apiFetch(url.toString());
  if (!res.ok) throw new Error(`/health ${res.status} ${res.statusText}`);
  return (await res.json()) as ServiceHealth;
}

/** GET /rag/health — 검색 on/off·DB 설정. */
export interface RagHealth {
  ragEnabled: boolean;
  dbConfigured: boolean;
}

export async function getRagHealth(): Promise<RagHealth> {
  const url = new URL("/rag/health", apiBase());
  const res = await apiFetch(url.toString());
  if (!res.ok) throw new Error(`/rag/health ${res.status} ${res.statusText}`);
  const d = (await res.json()) as RagHealth;
  return { ragEnabled: d.ragEnabled, dbConfigured: d.dbConfigured };
}
