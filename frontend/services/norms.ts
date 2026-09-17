/**
 * L0 규범 검토·편집 service (KB통합 3층검색 로드맵 P5, 2026-09-17).
 *
 * 규범 3종(답변 절차·해석 원칙·오류 패턴)은 **모든 AI 답변의 시스템 프롬프트**에 들어간다.
 * 원본은 DB norms.*(마이그레이션 0030) — RLS 로 프론트 직접 접근이 막혀 있어 반드시 Seam A
 * 백엔드를 거친다. 두 게이트: 초안(admin·auditor 누구나, 답변 영향 없음) → 확정(세무사만,
 * 즉시 전 답변 반영). 역할은 백엔드가 profiles 로 다시 판정한다.
 *
 * 이 화면이 편집하는 것은 백엔드 규범이다. /audit/knowledge 의 해설 시드(frontend/data/kb)와는
 * 다른 문서이고 동기화 의무가 없다(로드맵 P1 결정).
 */

function apiBase(): string {
  const base = process.env.NEXT_PUBLIC_API_BASE;
  if (!base) {
    throw new Error("NEXT_PUBLIC_API_BASE 미설정 — 규범 편집 비활성. frontend/.env.local 확인.");
  }
  return base;
}

export type NormName = "master" | "frameworks" | "pitfalls";

export interface NormVersion {
  id: string;
  /** 확정본만 번호가 있다. */
  versionNo?: number;
  content: string;
  status: "draft" | "confirmed" | "discarded";
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
  dbConfigured: boolean;
}

export interface NormVersionResult {
  ok: boolean;
  version?: NormVersion;
  error?: string;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const url = new URL(path, apiBase());
  let res: Response;
  try {
    res = await fetch(url.toString(), {
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

export function confirmDraft(
  versionId: string,
  body: { confirmerId: string; expectedUpdatedAt: number; note?: string },
): Promise<NormVersionResult> {
  return call<NormVersionResult>(`/api/norms/drafts/${versionId}/confirm`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ── 예산 미리보기 — 백엔드 build_norms 와 같은 규칙(주석 제거·trim·"\n\n" 결합) ──────────
// 판정은 서버가 다시 한다. 여기서는 저장 버튼을 미리 막는 용도.
export function injectedLength(contents: string[]): number {
  const parts = contents.map((c) => c.replace(/<!--[\s\S]*?-->/g, "").trim());
  return parts.reduce((sum, p) => sum + [...p].length, 0) + Math.max(0, parts.length - 1) * 2;
}
