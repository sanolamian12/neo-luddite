/**
 * backend/api/rag/ingest.py: build_bundle_text() 가 "[질문] …\n[AI 답변] …\n[세무사 코멘트] …"
 * 형태로 조립한 content 를 질문/답변/코멘트 세 줄로 되짚는다. kb-map-view(리스트 항목)와
 * kb-graph-view(노드 크기·호버 키워드) 가 공용으로 쓴다.
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
