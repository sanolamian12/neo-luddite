/** The fork is local by default. Live integration must be deliberately enabled. */
export const isPrototype = process.env.NEXT_PUBLIC_DATA_MODE !== "live";
/** 에이전트 스튜디오: 서버 저장·AI 반영(새 RAG 구축 뒤) 전까지 프로토타입 전용. 상담 요청 허브도 이 결정을 따른다. */
export const agentStudioEnabled = isPrototype;
export const prototypeOrigin = "https://prototype.invalid";

export function getApiBase(): string {
  if (isPrototype) return prototypeOrigin;
  const base = process.env.NEXT_PUBLIC_API_BASE;
  if (!base) throw new Error("NEXT_PUBLIC_API_BASE is required in live mode.");
  return base;
}
