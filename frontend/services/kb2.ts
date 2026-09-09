/**
 * 지식베이스2(kb2) service — admin 합성 트리거 + auditor 조회·직접 수정(로드맵 4단계).
 *
 * 설계 아티팩트(2026-09-03) §02·§07: 지금 시점 rag.passages(active) 로부터
 * Solar Pro 가 조항형 문장을 응축해 kb2.sentences 를 재구성한다. 4단계부터는 세무사가
 * /audit/kb2 에서 문장을 직접 수정할 수 있다 — 수정은 즉시 반영되고(승인 게이트 없음)
 * locked_by_auditor=true 로 전환돼 재합성에서 보호된다.
 */

function apiBase(): string {
  const base = process.env.NEXT_PUBLIC_API_BASE;
  if (!base) {
    throw new Error(
      "NEXT_PUBLIC_API_BASE 미설정 — kb2 합성 비활성. frontend/.env.local 확인.",
    );
  }
  return base;
}

export interface Kb2CategorySynthesisResult {
  taxCategory: string;
  documentId: string | null;
  created: number;
  lockedSkipped: number;
}

export interface Kb2SynthesizeResult {
  results: Kb2CategorySynthesisResult[];
  dbConfigured: boolean;
}

/** taxCategory 생략 시 전체 세목(17개) 순회. */
export async function synthesizeKb2(taxCategory?: string): Promise<Kb2SynthesizeResult> {
  const url = new URL("/admin/kb2/synthesize", apiBase());
  if (taxCategory) url.searchParams.set("taxCategory", taxCategory);
  let res: Response;
  try {
    res = await fetch(url.toString(), { method: "POST" });
  } catch (err) {
    throw new Error(
      `지식베이스2 합성 연결 실패(${url.origin}). 백엔드 기동 확인: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`/admin/kb2/synthesize ${res.status} ${res.statusText}: ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as { results?: Kb2CategorySynthesisResult[]; dbConfigured?: boolean };
  return { results: data.results ?? [], dbConfigured: data.dbConfigured ?? true };
}

// ── auditor 조회·직접 수정 (로드맵 4단계) ────────────────────────────────────────

export interface Kb2Document {
  id: string;
  taxCategory: string;
  title: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface Kb2SentenceAttribution {
  auditorId: string;
  weight: number;
}

export interface Kb2Sentence {
  id: string;
  documentId: string;
  orderIndex: number;
  content: string;
  sourcePassageIds: string[];
  attribution: Kb2SentenceAttribution[];
  lockedByAuditor: boolean;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface Kb2SentenceVersion {
  id: string;
  versionNo: number;
  content: string;
  attributionSnapshot: Kb2SentenceAttribution[];
  editorType: "system_synthesis" | "auditor_edit" | "admin_revert";
  editorId: string;
  createdAt: number;
}

export interface Kb2SourcePassage {
  id: string;
  content: string;
  taxCategory?: string;
  auditorId?: string;
}

async function getJson<T>(path: string): Promise<T> {
  const url = new URL(path, apiBase());
  let res: Response;
  try {
    res = await fetch(url.toString());
  } catch (err) {
    throw new Error(
      `지식베이스2 연결 실패(${url.origin}). 백엔드 기동 확인: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${path} ${res.status} ${res.statusText}: ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export async function listKb2Documents(): Promise<{ documents: Kb2Document[]; dbConfigured: boolean }> {
  const data = await getJson<{ documents?: Kb2Document[]; dbConfigured?: boolean }>("/api/kb2/documents");
  return { documents: data.documents ?? [], dbConfigured: data.dbConfigured ?? true };
}

export async function listKb2Sentences(
  documentId: string,
): Promise<{ sentences: Kb2Sentence[]; dbConfigured: boolean }> {
  const data = await getJson<{ sentences?: Kb2Sentence[]; dbConfigured?: boolean }>(
    `/api/kb2/documents/${encodeURIComponent(documentId)}/sentences`,
  );
  return { sentences: data.sentences ?? [], dbConfigured: data.dbConfigured ?? true };
}

export async function updateKb2Sentence(
  sentenceId: string,
  content: string,
  editorAuditorId: string,
): Promise<{ sentence: Kb2Sentence | null; dbConfigured: boolean }> {
  const url = new URL(`/api/kb2/sentences/${encodeURIComponent(sentenceId)}`, apiBase());
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, editorAuditorId }),
    });
  } catch (err) {
    throw new Error(
      `지식베이스2 수정 연결 실패(${url.origin}). 백엔드 기동 확인: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`/api/kb2/sentences/${sentenceId} ${res.status} ${res.statusText}: ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as { sentence?: Kb2Sentence | null; dbConfigured?: boolean };
  return { sentence: data.sentence ?? null, dbConfigured: data.dbConfigured ?? true };
}

export async function listKb2SentenceVersions(
  sentenceId: string,
): Promise<{ versions: Kb2SentenceVersion[]; dbConfigured: boolean }> {
  const data = await getJson<{ versions?: Kb2SentenceVersion[]; dbConfigured?: boolean }>(
    `/api/kb2/sentences/${encodeURIComponent(sentenceId)}/versions`,
  );
  return { versions: data.versions ?? [], dbConfigured: data.dbConfigured ?? true };
}

export async function listKb2SentenceSources(
  sentenceId: string,
): Promise<{ passages: Kb2SourcePassage[]; dbConfigured: boolean }> {
  const data = await getJson<{ passages?: Kb2SourcePassage[]; dbConfigured?: boolean }>(
    `/api/kb2/sentences/${encodeURIComponent(sentenceId)}/sources`,
  );
  return { passages: data.passages ?? [], dbConfigured: data.dbConfigured ?? true };
}

// ── AI 카테고리 재구조화 (로드맵 4.5단계) ────────────────────────────────────────

export type Kb2JobStage =
  | "discovering_categories"
  | "classifying_passages"
  | "synthesizing"
  | "done";

export interface Kb2Job {
  id: string;
  status: "running" | "done" | "error";
  stage: Kb2JobStage;
  totalCategories: number;
  completedCategories: number;
  result: { categoriesCreated?: number; documentsArchived?: number; note?: string } | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export async function startKb2Restructure(): Promise<{ jobId: string | null; dbConfigured: boolean }> {
  const url = new URL("/admin/kb2/restructure", apiBase());
  let res: Response;
  try {
    res = await fetch(url.toString(), { method: "POST" });
  } catch (err) {
    throw new Error(
      `지식베이스2 재구조화 연결 실패(${url.origin}). 백엔드 기동 확인: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`/admin/kb2/restructure ${res.status} ${res.statusText}: ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as { jobId?: string | null; dbConfigured?: boolean };
  return { jobId: data.jobId ?? null, dbConfigured: data.dbConfigured ?? true };
}

export async function getKb2RestructureJob(
  jobId: string,
): Promise<{ job: Kb2Job | null; dbConfigured: boolean }> {
  const data = await getJson<{ job?: Kb2Job | null; dbConfigured?: boolean }>(
    `/admin/kb2/restructure/${encodeURIComponent(jobId)}`,
  );
  return { job: data.job ?? null, dbConfigured: data.dbConfigured ?? true };
}

export async function listArchivedKb2Documents(): Promise<{ documents: Kb2Document[]; dbConfigured: boolean }> {
  const data = await getJson<{ documents?: Kb2Document[]; dbConfigured?: boolean }>(
    "/admin/kb2/documents?status=archived",
  );
  return { documents: data.documents ?? [], dbConfigured: data.dbConfigured ?? true };
}
