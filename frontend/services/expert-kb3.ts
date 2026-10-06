/**
 * 세무사 사례(kb3_expert) service — 에이전트 스튜디오의 서버 저장·게시·공용 KB 공유 (0043, 2026-10-06).
 *
 * 흐름(사용자 10/6): 가르치기 '검토한 지식 반영' → 서버 초안(답변 영향 없음) → 사례별 '게시' = 내 에이전트
 * (나에게 연결된 대화)에 반영 → 골라서 '공용 KB 로 보내기' → 관리자 승인 → 공용 KB3(모든 챗) + 크레딧.
 * 신원은 토큰(백엔드가 auth uid 로 판정) — 본문에 세무사 id 를 싣지 않는다.
 * 확인 질문·운영 원칙은 아직 브라우저 저장 그대로다(프롬프트 반영은 다음 과제).
 */

import { getApiBase as apiBase } from "@/lib/data-mode";
import { apiFetch } from "@/lib/api-fetch";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";

/** 시험칸이 쓰는 챗 응답 일부 — 화면은 문장과 근거 목록만 그린다. */
export interface PreviewResponse {
  message: { segments: { id: string; text: string; type: string }[] };
  meta: { ragSource?: string; ragCorpora?: Record<string, number>; ragCaseRefs?: string[]; ragPassages?: { corpus: string; id: string; rank: number | null; score: number; issueFit?: string }[] };
}

export type PublishState = "draft" | "published";
export type ShareState = "pending" | "approved" | "rejected";

export interface ServerExpertCase {
  id: string;
  agentId: string;
  localId: string;
  title: string;
  facts: string;
  judgment: string;
  conclusion: string;
  exceptions: string;
  keywords: string;
  publishState: PublishState;
  shareState?: ShareState;
  shareNote?: string;
  caseNumber?: string;
  expertName?: string;
  updatedAt: number;
}

interface CaseResponse {
  ok: boolean;
  case?: ServerExpertCase;
  cases?: ServerExpertCase[];
  error?: string;
  dbConfigured?: boolean;
}

export interface ShareQueueItem {
  case: ServerExpertCase;
  expertDomainId?: string;
  requestedAt: number;
  content: string;
}

/** GET 은 apiFetch 가 토큰을 붙이지 않는다(읽기 비인증 관례) — 이 API 는 '내 사례'라 직접 붙인다. */
async function authHeaders(): Promise<Headers> {
  const headers = new Headers();
  if (!isSupabaseConfigured) return headers;
  try {
    const { data } = await getSupabase().auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.set("Authorization", `Bearer ${token}`);
  } catch {
    // 세션 조회 실패 — 헤더 없이 보내 서버 401 로 드러나게 둔다.
  }
  return headers;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = await authHeaders();
  if (init.body) headers.set("Content-Type", "application/json");
  const res = await apiFetch(`${apiBase()}${path}`, { ...init, headers });
  if (!res.ok) {
    let detail = `${res.status}`;
    try { detail = ((await res.json()) as { detail?: string }).detail ?? detail; } catch { /* 본문 없음 */ }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

function unwrap(r: CaseResponse): CaseResponse {
  if (!r.ok) throw new Error(r.error ?? (r.dbConfigured === false ? "DB 미설정" : "요청 실패"));
  return r;
}

export async function listMyCases(): Promise<ServerExpertCase[]> {
  return unwrap(await call<CaseResponse>("/api/kb3/expert/cases")).cases ?? [];
}

export async function saveCase(input: {
  agentId: string; localId: string; title: string; facts: string; judgment: string;
  conclusion: string; exceptions: string; keywords: string;
}): Promise<ServerExpertCase> {
  return unwrap(await call<CaseResponse>("/api/kb3/expert/cases", { method: "POST", body: JSON.stringify(input) })).case!;
}

export async function setPublished(id: string, published: boolean): Promise<ServerExpertCase> {
  return unwrap(await call<CaseResponse>(`/api/kb3/expert/cases/${encodeURIComponent(id)}/publish`, {
    method: "POST", body: JSON.stringify({ published }),
  })).case!;
}

export async function shareCases(ids: string[]): Promise<ServerExpertCase[]> {
  return unwrap(await call<CaseResponse>("/api/kb3/expert/share", { method: "POST", body: JSON.stringify({ ids }) })).cases ?? [];
}

/** 실제 AI 시험칸 — 실제 챗 파이프라인 + 내 사례(초안 포함) + 공용 KB3. */
export async function previewAgent(text: string): Promise<PreviewResponse> {
  return call<PreviewResponse>("/api/kb3/expert/preview", { method: "POST", body: JSON.stringify({ text }) });
}

export async function listShareQueue(): Promise<ShareQueueItem[]> {
  const r = await call<{ ok: boolean; items?: ShareQueueItem[]; error?: string }>("/api/kb3/share-queue");
  if (!r.ok) throw new Error(r.error ?? "요청 실패");
  return r.items ?? [];
}

export async function reviewShare(id: string, approve: boolean, note?: string): Promise<{ shareState?: ShareState; ledgerId?: string }> {
  const r = await call<{ ok: boolean; shareState?: ShareState; ledgerId?: string; error?: string }>(
    `/admin/kb3/share/${encodeURIComponent(id)}/review`, { method: "POST", body: JSON.stringify({ approve, note }) });
  if (!r.ok) throw new Error(r.error ?? "요청 실패");
  return r;
}

/** 화면 표기 — 서버 상태 한 줄. */
export function caseStatusLabel(c: ServerExpertCase | undefined): string {
  if (!c) return "서버 미저장";
  if (c.publishState === "draft") return "초안 · 답변에 미반영";
  if (c.shareState === "approved") return "공용 KB 반영 · 모든 상담";
  if (c.shareState === "pending") return "게시 · 공용 KB 승인 대기";
  if (c.shareState === "rejected") return "게시 · 공용 KB 거부됨";
  return "게시 · 내 에이전트에 반영";
}
