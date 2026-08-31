import { evalContributionUnits } from "@/lib/audit-schema";
import { parseBundleContent } from "@/lib/kb-passage-text";

/**
 * KB 그래프 노드의 시각적 크기·라벨을 계산하는 공용 로직 — kb-graph-view(전체 그래프)와
 * kb-passage-detail-view(1-hop 상세뷰)가 "같은 정보량은 같은 크기로" 보이도록 공유한다.
 * 원래 kb-graph-view.tsx 안에만 있던 걸 상세뷰에서도 쓰기 위해 여기로 뺐다(2026-08-31).
 */

// 총평/문장코멘트 크레딧 산정과 같은 글자수 6구간 눈금(frontend/lib/audit-schema.ts)을
// 노드 크기에도 그대로 쓴다 — 세무사가 실제로 쓴 텍스트(코멘트/총평)가 길수록 큰 원.
export function contributionUnits(content: string): number {
  const { comment } = parseBundleContent(content);
  return evalContributionUnits(comment || content);
}

export function nodeRadius(units: number): number {
  return 6 + units * 2.4;
}

// 노드 라벨용 — 형태소 분석기 없이 쓰는 가벼운 휴리스틱: 조사/흔한 상투어를 거르고
// 남은 토큰 중 가장 긴 것(한국어에서 길수록 조사가 아닌 실질 명사일 확률이 높다)을 고른다.
const KEYWORD_STOPWORDS = new Set([
  "그리고", "그런데", "그러면", "그래서", "저는", "제가", "저희", "이번", "오늘", "혹시",
  "합니다", "했습니다", "되나요", "되는지", "궁금합니다", "드립니다", "있나요", "있을까요",
  "무엇인가요", "어떻게", "입니다", "것인가요", "인가요", "있는지", "하는지", "해야",
]);

function significantWords(text: string): string[] {
  return text
    .replace(/[.,!?()"'…\-·]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !KEYWORD_STOPWORDS.has(w));
}

// 형태소 분석기 없이 명사 위주로 고르는 트릭 — 조사를 떼진 않되(번거로움), 한국어 술어
// (동사/형용사)는 활용형 어미가 거의 고정 패턴으로 끝난다는 점을 이용해 그런 단어를
// 후보에서 낮은 우선순위로 민다. 다 걸러지면(짧은 문장 등) 원래 후보로 폴백한다.
const PREDICATE_ENDING =
  /(습니다|ㅂ니다|니다|여요|아요|어요|나요|가요|네요|이에요|예요|이죠|죠|겠나요|겠습니까|입니까|하는지|되는지|했는지|한다면|하다면|다면|한다|했다|였다|이다|합니다|하셨나요|하시나요|되시나요|했나요)$/;

function isNounLike(word: string): boolean {
  return !PREDICATE_ENDING.test(word);
}

/**
 * "유사도를 판단하는 핵심 단어"의 근사치 — 형태소 분석기·재임베딩 없이 쓰는 휴리스틱.
 * rag.match_passages 가 실제로 비교하는 벡터는 passage.content 전체(build_bundle_text 가
 * 조립한 [질문]+[AI 답변]+[세무사 코멘트]+태그)를 임베딩한 값이다(backend/api/rag/ingest.py).
 * 같은 문서 안에서 여러 번 반복되는 단어일수록 그 문서의 임베딩 방향을 더 세게 끌고
 * 가는 경향이 있으므로, "이 passage 안에서의 등장 빈도"를 살리는 것(TF)이 어느 한
 * 섹션(질문만/코멘트만)에서 고르는 것보다 실제 유사도 판정에 가깝다.
 */
export function extractSalientWords(text: string, max = 3): string[] {
  const words = significantWords(text);
  const nounLike = words.filter(isNounLike);
  const pool = nounLike.length > 0 ? nounLike : words;
  const freq = new Map<string, number>();
  for (const w of pool) freq.set(w, (freq.get(w) ?? 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, max)
    .map(([w]) => w);
}

/**
 * 노드 라벨 — passage 전체(임베딩 대상 텍스트 그대로)에서 등장 빈도 기준 핵심 단어 2~3개.
 * 포커스 여부와 무관하게 항상 같은 키워드 묶음이 보이도록 호버/포커스 상태를 안 탄다.
 */
export function nodeKeywords(content: string, max = 3): string[] {
  return extractSalientWords(content, max);
}
