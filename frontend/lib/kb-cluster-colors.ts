import { FileText, MessageSquare, Scale, Sparkles } from "lucide-react";
import type { PassageInfo } from "@/services/rag";

/**
 * RAG 지식망(kb-map-view, kb-graph-view) 전체에서 클러스터 라벨 → 색상을 한 곳에서
 * 결정한다. 예전엔 두 파일이 각자 `hashHue`(단순 문자열 해시 % 360)를 따로 갖고 있었는데,
 * 알려진 세목 18개(taxonomy.py 17개 + 미분류)를 이 해시에 넣어보면 최소 간격이 1도까지
 * 붙는 쌍이 여럿 나온다(예: 출장비/미분류, 접대성지출/임차료) — 사실상 같은 색으로 보임.
 * 그래서 알려진 라벨 목록은 골든 앵글(137.508°) 간격으로 색을 미리 배정해 최소 간격을
 * 보장하고, 목록에 없는 라벨(미래에 추가될 값 등)만 기존 해시로 폴백한다.
 */

export const SOURCE_KIND_META: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  feedback: { label: "세무사 코멘트", icon: MessageSquare },
  session_eval: { label: "세션 총평", icon: Sparkles },
  case_seed: { label: "판례 시드", icon: Scale },
  kb_document: { label: "큐레이션 문서", icon: FileText },
};

export function sourceKindMeta(kind: string) {
  return SOURCE_KIND_META[kind] ?? { label: kind, icon: FileText };
}

// backend/api/rag/taxonomy.py: TAX_CATEGORIES 와 순서까지 동일하게 유지할 것 — 순서로
// 색을 배정하므로, 순서가 어긋나면 그래프 노드 색과 클러스터 카드 색이 서로 달라진다.
const TAX_CATEGORIES = [
  "업무용승용차",
  "임차료",
  "접대성지출",
  "광고선전비",
  "통신비",
  "복리후생비",
  "출장비",
  "소프트웨어구독",
  "가사관련비",
  "인건비·가족직원",
  "퇴직금·4대보험",
  "시설·인테리어",
  "부가가치세",
  "상속·증여",
  "소득세·법인전환·개원폐업",
  "매출관리",
  "기타",
];

export const UNCLASSIFIED = "미분류";

const GOLDEN_ANGLE = 137.508;

function goldenHues(labels: string[]): Map<string, number> {
  const map = new Map<string, number>();
  labels.forEach((label, i) => map.set(label, Math.round((i * GOLDEN_ANGLE) % 360)));
  return map;
}

const TAX_HUES = goldenHues([...TAX_CATEGORIES, UNCLASSIFIED]);
const SOURCE_KIND_HUES = goldenHues(Object.values(SOURCE_KIND_META).map((m) => m.label));
const OCCUPATION_HUES = goldenHues(["clinic"]);

function fallbackHashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** 클러스터 라벨(세목/직업군/유형 값) → 고정 hue(0~359). */
export function clusterHue(label: string): number {
  return (
    TAX_HUES.get(label) ??
    SOURCE_KIND_HUES.get(label) ??
    OCCUPATION_HUES.get(label) ??
    fallbackHashHue(label)
  );
}

/** kb-graph-view 전용 — 노드 하나의 대표 클러스터 라벨(우선순위: 세목 > 직업군 > 유형). */
export function primaryClusterLabel(p: PassageInfo): string {
  return p.taxCategory || p.occupation || sourceKindMeta(p.sourceKind).label;
}
