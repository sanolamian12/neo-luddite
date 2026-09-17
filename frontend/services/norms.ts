/**
 * L0 규범 검토·편집 service (KB통합 3층검색 로드맵 P5, 2026-09-17).
 *
 * 규범 3종(답변 절차·해석 원칙·오류 패턴)은 **모든 AI 답변의 시스템 프롬프트**에 들어간다.
 * 원본은 DB norms.*(마이그레이션 0030) — RLS 로 프론트 직접 접근이 막혀 있어 반드시 Seam A
 * 백엔드를 거친다. 거버넌스(P6 ②): 초안(admin·auditor 누구나, 답변 영향 없음) → 공개(이의 기간) →
 * 반영(세무사 승인 문턱 또는 기한 경과, 이의 없을 때). 신원은 토큰, 역할은 백엔드가 profiles 로 판정한다.
 *
 * 이 화면이 편집하는 것은 백엔드 규범이다. /audit/knowledge 의 해설 시드(frontend/data/kb)와는
 * 다른 문서이고 동기화 의무가 없다(로드맵 P1 결정).
 */

import { apiFetch } from "@/lib/api-fetch";

function apiBase(): string {
  const base = process.env.NEXT_PUBLIC_API_BASE;
  if (!base) {
    throw new Error("NEXT_PUBLIC_API_BASE 미설정 — 규범 편집 비활성. frontend/.env.local 확인.");
  }
  return base;
}

export type NormName = "master" | "frameworks" | "pitfalls";

export type NormDecisionKind = "approve" | "object";

export interface NormDecision {
  auditorId: string;
  decision: NormDecisionKind;
  reason?: string;
  createdAt: number;
}

export interface NormVersion {
  id: string;
  /** 확정본만 번호가 있다. */
  versionNo?: number;
  content: string;
  /** pending = 공개 중(이의 기간). 답변엔 아직 영향 없음. */
  status: "draft" | "pending" | "confirmed" | "discarded" | "rejected";
  publishedBy?: string;
  publishedAt?: number;
  /** 이 시각이 지나고 이의가 없으면 자동 반영(침묵 = 동의). */
  deadlineAt?: number;
  appliedVia?: "direct" | "approvals" | "deadline" | "rollback";
  /** admin 브레이크(거부·롤백) 사유. 거부한 사람·시각은 discardedBy/At. */
  adminReason?: string;
  /** 공개 중일 때 유효 결정. */
  decisions: NormDecision[];
  /** 작성자·공개자 제외 승인 수. */
  approvals: number;
  objections: number;
  baseVersionId?: string;
  note?: string;
  authorId: string;
  updatedBy: string;
  confirmedBy?: string;
  confirmedAt?: number;
  discardedBy?: string;
  discardedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface NormDocument {
  name: NormName;
  title: string;
  active?: NormVersion;
  draft?: NormVersion;
}

export interface NormsOverview {
  documents: NormDocument[];
  maxChars: number;
  activeChars: number;
  /** 백엔드 프로세스가 지금 주입 중인 출처 — md/none 이면 DB 확정본이 답변에 안 들어가는 상태. */
  injectedSource: "db" | "md" | "none";
  injectedChars: number;
  /** 즉시 반영에 필요한 승인 수(작성자·공개자 제외). */
  fastApprovals: number;
  objectionPeriodSec: number;
  dbConfigured: boolean;
}

export interface NormVersionResult {
  ok: boolean;
  /** 이 요청으로 반영까지 됐는지(승인 문턱 도달·이의 철회). */
  applied?: boolean;
  version?: NormVersion;
  error?: string;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const url = new URL(path, apiBase());
  let res: Response;
  try {
    res = await apiFetch(url.toString(), {
      ...init,
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      cache: "no-store",
    });
  } catch (err) {
    throw new Error(
      `규범 API 연결 실패(${url.origin}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${path} ${res.status} ${res.statusText}: ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export function getNorms(): Promise<NormsOverview> {
  return call<NormsOverview>("/api/norms");
}

export async function listVersions(name: NormName): Promise<NormVersion[]> {
  const data = await call<{ versions?: NormVersion[] }>(`/api/norms/${name}/versions`);
  return data.versions ?? [];
}

export function saveDraft(
  name: NormName,
  body: {
    content: string;
    editorId: string;
    note?: string;
    /** 기존 초안을 고칠 때 — 화면이 불러온 초안의 updatedAt(다른 사람이 먼저 고쳤으면 거절). */
    expectedUpdatedAt?: number;
    /** 되돌리기 — 이 확정본 내용으로 새 초안. */
    baseVersionId?: string;
  },
): Promise<NormVersionResult> {
  return call<NormVersionResult>(`/api/norms/${name}/draft`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function discardDraft(versionId: string, editorId: string): Promise<NormVersionResult> {
  return call<NormVersionResult>(`/api/norms/drafts/${versionId}/discard`, {
    method: "POST",
    body: JSON.stringify({ editorId }),
  });
}

/** 초안 공개 — 이의 기간 시작(P6 ②). 답변은 반영 전까지 그대로. */
export function publishDraft(
  versionId: string,
  body: { expectedUpdatedAt: number; note?: string },
): Promise<NormVersionResult> {
  return call<NormVersionResult>(`/api/norms/drafts/${versionId}/publish`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** 세무사 승인·이의(이의는 사유 필수). 승인 문턱을 넘고 이의가 없으면 applied=true. */
export function decide(
  versionId: string,
  body: { decision: NormDecisionKind; reason?: string; expectedUpdatedAt: number },
): Promise<NormVersionResult> {
  return call<NormVersionResult>(`/api/norms/proposals/${versionId}/decision`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** 본인 승인·이의 철회. */
export function withdrawDecision(versionId: string): Promise<NormVersionResult> {
  return call<NormVersionResult>(`/api/norms/proposals/${versionId}/withdraw`, { method: "POST" });
}

/** admin 사후 브레이크(P6 ③) — 공개 중 제안 거부. 사유 필수. */
export function rejectProposal(versionId: string, reason: string): Promise<NormVersionResult> {
  return call<NormVersionResult>(`/api/norms/proposals/${versionId}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

/** admin 사후 브레이크(P6 ③) — 확정본을 직전 확정본 내용으로 즉시 롤백. 사유 필수. */
export function rollback(
  name: NormName,
  body: { reason: string; expectedActiveVersionId: string },
): Promise<NormVersionResult> {
  return call<NormVersionResult>(`/api/norms/${name}/rollback`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** 내가 아직 승인·이의를 남기지 않은 공개 중 제안 — 로그인 팝업·사이드바 배지 기준.
 *  작성자·공개자 본인의 제안은 뺀다(스스로 승인할 수 없으므로 "할 일"이 아니다). */
export function awaitingMyDecision(overview: NormsOverview, me: string): NormDocument[] {
  return overview.documents.filter((d) => {
    const p = d.draft;
    if (!p || p.status !== "pending") return false;
    if (p.authorId === me || p.publishedBy === me) return false;
    return !p.decisions.some((x) => x.auditorId === me);
  });
}

// ── 예산 미리보기 — 백엔드 build_norms 와 같은 규칙(주석 제거·trim·"\n\n" 결합) ──────────
// 판정은 서버가 다시 한다. 여기서는 저장 버튼을 미리 막는 용도.
export function injectedLength(contents: string[]): number {
  const parts = contents.map((c) => c.replace(/<!--[\s\S]*?-->/g, "").trim());
  return parts.reduce((sum, p) => sum + [...p].length, 0) + Math.max(0, parts.length - 1) * 2;
}
