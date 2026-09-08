/**
 * 지식베이스2(kb2) service — admin 전용 합성 트리거.
 *
 * 설계 아티팩트(2026-09-03) §02·§07: 지금 시점 rag.passages(active) 로부터
 * Solar Pro 가 조항형 문장을 응축해 kb2.sentences 를 재구성한다. 검색 전환(3단계)·
 * auditor 수정(4단계) 이전 단계라 지금은 이 트리거 함수 하나만 필요하다.
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
