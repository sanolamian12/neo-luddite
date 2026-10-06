/** The fork is local by default. Live integration must be deliberately enabled. */
export const isPrototype = process.env.NEXT_PUBLIC_DATA_MODE !== "live";
/** 에이전트 스튜디오: 서버 저장·AI 반영(새 RAG 구축 뒤) 전까지 프로토타입 전용. 상담 요청 허브도 이 결정을 따른다. */
export const agentStudioEnabled = isPrototype;
/** 내 에이전트(가르치기·지식 모음·운영 원칙·미리보기) — live 에서도 연다(10/6). 답변 사례는 서버(KB3 kb3_expert)에
 * 저장·게시되고, 질문·원칙은 아직 브라우저 저장. 고급 설정(그래프)·새 대시보드·상담 허브는 agentStudioEnabled 그대로. */
export const expertTeachingEnabled = true;
export const prototypeOrigin = "https://prototype.invalid";

export function getApiBase(): string {
  if (isPrototype) return prototypeOrigin;
  const base = process.env.NEXT_PUBLIC_API_BASE;
  if (!base) throw new Error("NEXT_PUBLIC_API_BASE is required in live mode.");
  return base;
}
