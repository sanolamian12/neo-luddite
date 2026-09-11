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
  /** 'active' | 'retired'(사람이 연결 끊음) | 'archived'(재구조화로 세대교체) */
  title: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  groupId?: string | null;
  /** 마지막 상태 전환 사유/행위자 — 왜 끊겼는지 화면에 바로 보여주기 위한 것. */
  statusReason?: string | null;
  statusActor?: string | null;
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
  lockedBy?: string | null;
  effectivelyLocked: boolean;
  status: "active" | "retired";
}

export interface Kb2SentenceVersion {
  id: string;
  versionNo: number;
  content: string;
  attributionSnapshot: Kb2SentenceAttribution[];
  editorType: "system_synthesis" | "auditor_edit" | "admin_revert" | "moved" | "retired" | "reconnected";
  editorId: string;
  createdAt: number;
  meta?: { fromDocumentId?: string; toDocumentId?: string; reason?: string } | null;
}

export interface Kb2Group {
  id: string;
  label: string;
  status: string;
  createdAt: number;
  updatedAt: number;
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

async function sendJson<T>(path: string, method: "POST" | "PATCH", body: unknown): Promise<T> {
  const url = new URL(path, apiBase());
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
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

// ── 대목(그룹) ───────────────────────────────────────────────────────────────

export async function listKb2Groups(): Promise<{ groups: Kb2Group[]; dbConfigured: boolean }> {
  const data = await getJson<{ groups?: Kb2Group[]; dbConfigured?: boolean }>("/api/kb2/groups");
  return { groups: data.groups ?? [], dbConfigured: data.dbConfigured ?? true };
}

export async function createKb2Group(label: string): Promise<{ group: Kb2Group | null; dbConfigured: boolean }> {
  const data = await sendJson<{ group?: Kb2Group | null; dbConfigured?: boolean }>(
    "/api/kb2/groups", "POST", { label },
  );
  return { group: data.group ?? null, dbConfigured: data.dbConfigured ?? true };
}

/** "미분류" 세목만 Solar Pro가 표준 세무 대분류로 묶어 자동 배정. 이미 대목이 지정된
 * 세목은 건드리지 않는다. */
export async function autoGroupKb2Documents(): Promise<{
  groupsCreated: number;
  documentsGrouped: number;
  dbConfigured: boolean;
}> {
  const data = await sendJson<{ groupsCreated?: number; documentsGrouped?: number; dbConfigured?: boolean }>(
    "/api/kb2/documents/auto-group", "POST", {},
  );
  return {
    groupsCreated: data.groupsCreated ?? 0,
    documentsGrouped: data.documentsGrouped ?? 0,
    dbConfigured: data.dbConfigured ?? true,
  };
}

// ── 세목(문서) 생성·이름수정·그룹지정 ────────────────────────────────────────────

export async function createKb2Document(
  groupId: string | null,
  title: string,
): Promise<{ document: Kb2Document | null; dbConfigured: boolean }> {
  const data = await sendJson<{ document?: Kb2Document | null; dbConfigured?: boolean }>(
    "/api/kb2/documents", "POST", { groupId, title },
  );
  return { document: data.document ?? null, dbConfigured: data.dbConfigured ?? true };
}

export async function renameKb2Document(
  documentId: string,
  title: string,
): Promise<{ document: Kb2Document | null; dbConfigured: boolean }> {
  const data = await sendJson<{ document?: Kb2Document | null; dbConfigured?: boolean }>(
    `/api/kb2/documents/${encodeURIComponent(documentId)}`, "PATCH", { title },
  );
  return { document: data.document ?? null, dbConfigured: data.dbConfigured ?? true };
}

export async function setKb2DocumentGroup(
  documentId: string,
  groupId: string | null,
): Promise<{ document: Kb2Document | null; dbConfigured: boolean }> {
  const data = await sendJson<{ document?: Kb2Document | null; dbConfigured?: boolean }>(
    `/api/kb2/documents/${encodeURIComponent(documentId)}/group`, "PATCH", { groupId },
  );
  return { document: data.document ?? null, dbConfigured: data.dbConfigured ?? true };
}

/** 세목(문서) 연결 끊기/재연결 — 삭제가 아니라 상태 전환(문장 단위와 같은 규약).
 * retired 가 되면 그 세목의 문장은 검색에서 빠지지만 문장·이력·기여는 그대로 남고
 * 언제든 재연결할 수 있다. 사유는 필수 — kb2.document_events 에 남는다. */
export async function setKb2DocumentStatus(
  documentId: string,
  status: "active" | "retired",
  editorAuditorId: string,
  reason: string,
): Promise<{ document: Kb2Document | null; dbConfigured: boolean }> {
  const data = await sendJson<{ document?: Kb2Document | null; dbConfigured?: boolean }>(
    `/api/kb2/documents/${encodeURIComponent(documentId)}/status`, "PATCH",
    { status, editorAuditorId, reason },
  );
  return { document: data.document ?? null, dbConfigured: data.dbConfigured ?? true };
}

/** 대목(그룹) 삭제 — 대목은 지식이 없는 순수 정리 계층이라 지운다. 속한 세목은 같이
 * 지워지지 않고 "미분류"로 풀려난다. 반환: 풀려난 세목 수. */
export async function deleteKb2Group(
  groupId: string,
  actorId: string,
): Promise<{ deleted: boolean; detachedDocuments: number }> {
  const url = new URL(`/api/kb2/groups/${encodeURIComponent(groupId)}`, apiBase());
  url.searchParams.set("actorId", actorId);
  const res = await fetch(url.toString(), { method: "DELETE" });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`대목 삭제 실패 ${res.status} ${res.statusText}: ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as { deleted?: boolean; detachedDocuments?: number };
  return { deleted: data.deleted ?? false, detachedDocuments: data.detachedDocuments ?? 0 };
}

// ── 문장 이동·편집 락 ────────────────────────────────────────────────────────────

export async function moveKb2Sentence(
  sentenceId: string,
  targetDocumentId: string,
  editorAuditorId: string,
): Promise<{ sentence: Kb2Sentence | null; dbConfigured: boolean }> {
  const data = await sendJson<{ sentence?: Kb2Sentence | null; dbConfigured?: boolean }>(
    `/api/kb2/sentences/${encodeURIComponent(sentenceId)}/move`, "POST",
    { targetDocumentId, editorAuditorId },
  );
  return { sentence: data.sentence ?? null, dbConfigured: data.dbConfigured ?? true };
}

export async function acquireKb2SentenceLock(
  sentenceId: string,
  auditorId: string,
): Promise<{ ok: boolean; lockedBy: string | null; dbConfigured: boolean }> {
  const data = await sendJson<{ ok?: boolean; lockedBy?: string | null; dbConfigured?: boolean }>(
    `/api/kb2/sentences/${encodeURIComponent(sentenceId)}/lock`, "POST", { auditorId },
  );
  return { ok: data.ok ?? false, lockedBy: data.lockedBy ?? null, dbConfigured: data.dbConfigured ?? true };
}

export async function releaseKb2SentenceLock(sentenceId: string, auditorId: string): Promise<void> {
  await sendJson(`/api/kb2/sentences/${encodeURIComponent(sentenceId)}/unlock`, "POST", { auditorId });
}

/** 연결 끊기/재연결(배선실 패턴) — 사유(reason)를 필수로 받아 버전 히스토리에 남긴다. */
export async function setKb2SentenceStatus(
  sentenceId: string,
  status: "active" | "retired",
  editorAuditorId: string,
  reason: string,
): Promise<{ sentence: Kb2Sentence | null; dbConfigured: boolean }> {
  const data = await sendJson<{ sentence?: Kb2Sentence | null; dbConfigured?: boolean }>(
    `/api/kb2/sentences/${encodeURIComponent(sentenceId)}/status`, "POST",
    { status, editorAuditorId, reason },
  );
  return { sentence: data.sentence ?? null, dbConfigured: data.dbConfigured ?? true };
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
  | "scheduled"
  | "cancelled"
  | "discovering_categories"
  | "merging_categories"
  | "classifying_passages"
  | "synthesizing"
  | "done";

export interface Kb2Coverage {
  passagesTotal: number;
  /** 어느 세목에든 배정된 건수(미분류 제외). */
  assigned: number;
  unclassified: number;
  /** 분류 LLM 호출 수(건별이라 passagesTotal 과 같아야 정상). */
  classifyCalls: number;
  /** 합성 프롬프트 호출 수 — 세목이 크면 한 세목이 여러 번 나뉘어 들어간다. */
  synthesisChunks: number;
  /** 생성된 문장 수. */
  sentences: number;
  /** 합성 프롬프트에 실제로 들어간 건수. */
  fed: number;
  /** 프롬프트 예산에 밀려 투입되지 못한 건수. */
  truncated: number;
  /** 문장의 근거로 실제 인용된 서로 다른 원본 건수 — KB2 가 담은 실질 범위. */
  cited: number;
  citedRatio: number;
  hallucinatedIdsDropped: number;
}

export interface Kb2CategoryStat {
  label: string;
  assigned: number;
  fed: number;
  truncated: number;
  chunks: number;
  sentences: number;
  cited: number;
}

export interface Kb2Job {
  id: string;
  status: "scheduled" | "running" | "done" | "error" | "cancelled";
  stage: Kb2JobStage;
  totalCategories: number;
  completedCategories: number;
  result: {
    categoriesCreated?: number;
    documentsArchived?: number;
    note?: string;
    /** 커버리지 깔때기(2026-09-11) — 원본 → 분류 배정 → 프롬프트 투입 → 실제 인용.
     * 어느 단계에서 원문이 새는지 재실행 없이 비교하기 위한 계측이다. */
    coverage?: Kb2Coverage;
    categoryStats?: Kb2CategoryStat[];
  } | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  /** 예약 실행 시각(epoch ms). 즉시 실행 job 은 null. */
  scheduledAt: number | null;
  triggerSource: "manual" | "scheduled";
}

/** scheduleAt(epoch ms)을 주면 그 시각에 실행되도록 예약만 하고, 없으면 즉시 실행.
 * 예약 시각은 호출측(브라우저 로컬=KST)이 계산한다 — 서버는 도쿄 박스라 서버 로컬
 * 시간으로 "새벽 3시"를 해석하면 의도와 어긋난다. */
export async function startKb2Restructure(
  scheduleAt?: number,
): Promise<{ jobId: string | null; scheduledAt: number | null; dbConfigured: boolean }> {
  const url = new URL("/admin/kb2/restructure", apiBase());
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scheduleAt ? { scheduleAt } : {}),
    });
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
  const data = (await res.json()) as {
    jobId?: string | null;
    scheduledAt?: number | null;
    dbConfigured?: boolean;
  };
  return {
    jobId: data.jobId ?? null,
    scheduledAt: data.scheduledAt ?? null,
    dbConfigured: data.dbConfigured ?? true,
  };
}

/** 아직 실행 안 된 예약 목록 — 화면 진입 시 "예약됨" 상태를 복원한다(예약은 DB에
 * 있으므로 브라우저를 닫았다 열어도, 백엔드가 재시작돼도 살아있다). */
export async function listKb2ScheduledJobs(): Promise<{ jobs: Kb2Job[]; dbConfigured: boolean }> {
  const data = await getJson<{ jobs?: Kb2Job[]; dbConfigured?: boolean }>(
    "/admin/kb2/restructure/scheduled",
  );
  return { jobs: data.jobs ?? [], dbConfigured: data.dbConfigured ?? true };
}

/** 예약 취소. 이미 실행에 들어갔으면 cancelled=false. */
export async function cancelKb2ScheduledJob(jobId: string): Promise<{ cancelled: boolean }> {
  const url = new URL(
    `/admin/kb2/restructure/${encodeURIComponent(jobId)}/cancel`,
    apiBase(),
  );
  const res = await fetch(url.toString(), { method: "POST" });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`예약 취소 실패 ${res.status} ${res.statusText}: ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as { cancelled?: boolean };
  return { cancelled: data.cancelled ?? false };
}

export async function getKb2RestructureJob(
  jobId: string,
): Promise<{ job: Kb2Job | null; dbConfigured: boolean }> {
  const data = await getJson<{ job?: Kb2Job | null; dbConfigured?: boolean }>(
    `/admin/kb2/restructure/${encodeURIComponent(jobId)}`,
  );
  return { job: data.job ?? null, dbConfigured: data.dbConfigured ?? true };
}

/** 가장 최근에 끝난 재구조화 job — 화면 진입 시 지난 회차 커버리지 계측 복원용.
 * 실행을 건 탭이 없어도(=새벽 예약 실행) 결과를 볼 수 있어야 한다. */
export async function getLatestKb2RestructureJob(): Promise<{
  job: Kb2Job | null;
  dbConfigured: boolean;
}> {
  const data = await getJson<{ job?: Kb2Job | null; dbConfigured?: boolean }>(
    "/admin/kb2/restructure/latest",
  );
  return { job: data.job ?? null, dbConfigured: data.dbConfigured ?? true };
}

export async function listArchivedKb2Documents(): Promise<{ documents: Kb2Document[]; dbConfigured: boolean }> {
  const data = await getJson<{ documents?: Kb2Document[]; dbConfigured?: boolean }>(
    "/admin/kb2/documents?status=archived",
  );
  return { documents: data.documents ?? [], dbConfigured: data.dbConfigured ?? true };
}
