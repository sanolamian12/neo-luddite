/**
 * backend/api/rag/ingest.py: build_bundle_text() 가 "[질문] …\n[AI 답변] …\n[세무사 코멘트] …
 * \n(태그: …)" 형태로 조립한 content 를 되짚는다. kb-map-view(리스트 항목)와 kb-graph-view
 * (노드 크기·호버 키워드), kb-passage-detail-view(상세뷰) 가 공용으로 쓴다.
 */
export function parseBundleContent(content: string): {
  question: string;
  answer: string;
  comment: string;
} {
  let question = "";
  let answer = "";
  let comment = "";
  for (const line of content.split("\n")) {
    if (line.startsWith("[질문]")) question = line.replace(/^\[질문\]\s*/, "");
    else if (line.startsWith("[AI 답변]")) answer = line.replace(/^\[AI 답변\]\s*/, "");
    else if (line.startsWith("[세무사 코멘트]")) comment = line.replace(/^\[세무사 코멘트\]\s*/, "");
  }
  return { question, answer, comment };
}

/**
 * AI 답변 자리에 보여줄 문구 — 실제 답변이 있으면 그대로, 없으면 왜 없는지 안내한다.
 * feedback 소스는 frontend/services/rag.ts resolveBundle() 이 "코멘트가 사용자 자신의
 * 질문 세그먼트에 달렸으면 답변은 안 싣는다"고 설계돼 있어(2026-08-27 KB 실사례로 발견)
 * 실제 결측이 아니라 "이 코멘트는 애초에 질문 문장 자체에 대한 것" 이라는 신호다. 빈
 * "—" 로만 보이면 데이터 결손처럼 오해하기 쉬워 이유를 밝힌다. session_eval 등 다른
 * sourceKind 는 이 설계가 적용되지 않으므로(실제 결측일 수 있음) 그대로 "—".
 */
export function answerDisplay(sourceKind: string, answer: string): string {
  if (answer) return answer;
  if (sourceKind === "feedback") return "(질문자의 챗에 달린 세무사 코멘트입니다.)";
  return "—";
}

/**
 * build_bundle_text() 가 붙이는 "(태그: 법적 해석 오류, 제안)" 줄을 되짚는다. 이 줄은
 * FEEDBACK_TAG_LABELS(frontend/lib/audit-schema.ts) 값을 쉼표로 이은 것 — 백엔드
 * _TAG_LABELS 와 문구가 살짝 다를 수 있어(제안 vs 제안사항) 라벨 문자열 그대로 비교하지
 * 않고 포함 관계로 매칭한다(parseTagLabels 호출부 참고).
 * session_eval 번들의 "(평가: …)" 줄은 다른 형식이라 여기 매칭 대상이 아니다.
 */
export function parseTagsLine(content: string): string[] | null {
  const line = content.split("\n").find((l) => /^\(태그:\s*.+\)$/.test(l.trim()));
  if (!line) return null;
  const inner = line.trim().replace(/^\(태그:\s*/, "").replace(/\)$/, "");
  return inner
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}
