import { demoHref, scenePath, type DemoRun, type Scene } from "./domain";

export const demoActs = [
  { id: "A", title: "상담", description: "고객의 질문을 AI와 세무사가 함께 해결합니다.", scenes: ["A1", "A2", "A3", "A4", "A5", "A6", "A7"] },
  { id: "B", title: "가르치기", description: "세무사가 상담에서 배운 지식을 AI에게 가르치고, 공유할 내용을 고릅니다.", scenes: ["B1", "B2", "B3", "B4", "B5"] },
  { id: "C", title: "함께 쓰는 지식", description: "운영자가 공유 지식을 검토·반영하면, 기여가 기록되고 다음 상담으로 이어집니다.", scenes: ["C1", "C2", "C3", "C4", "C5"] },
] as const;

export function demoNavigation(run: DemoRun, path: string, common: boolean) {
  const role = path.startsWith("/admin/") ? "admin" : path.startsWith("/audit/") ? "expert" : "customer";
  const draft = run.agent.practice.learning?.draft;
  const applied = run.agent.practice.cases.some(item => item.id === draft?.id);
  const shared = run.board.entries.some(item => item.author.id === run.agent.owner && item.revisions.length > 0);
  const batch = run.batches.at(-1);
  const conversation: Scene = run.completed ? "A7" : run.controller === "expert" ? "A6" : run.requested ? "A5" : run.expertId ? "A4" : run.recommended ? "A3" : run.messages.length ? "A2" : "A1";
  // The visible scene follows the current screen, including when revisiting an earlier act.
  const scene: Scene = common ? "C5" : path.includes("/teach") ? draft ? "B3" : run.selection.opened ? "B2" : "B1" : path.includes("/preview") ? "B4" : path.includes("/ledger") ? "C4" : path.includes("/batches") ? batch ? "C3" : "C2" : path.includes("knowledge-contributions") ? "C1" : path.includes("/contributions") || path.includes("/knowledge") || path.includes("/principles") || path.endsWith("/agents") ? "B5" : conversation;
  let next: { scene: Scene; label: string; href?: string } | null = null;
  if (common) next = null;
  else if (path.includes("/chat/") && run.requested && run.controller !== "expert" && !run.completed) next = { scene: "A6", label: "세무사 화면에서 직접 답변" };
  else if ((path.includes("/consultations") || path.includes("/chat/")) && run.completed) next = { scene: "B1", label: "이 상담으로 AI 가르치기" };
  else if (path.includes("/consultations") && run.messages.some(item => item.author === "expert")) next = { scene: "A6", label: "고객 화면에서 답변 확인", href: demoHref(`/chat/clinic?c=${run.conversationId}`, run.id) };
  else if (path.includes("/chat/") && run.controller === "expert") next = { scene: "A6", label: "세무사 화면에서 상담 마무리" };
  else if (path.includes("/teach") && applied) next = { scene: "B4", label: "가르치기 전후 비교하기" };
  else if (path.includes("/preview") && applied) next = { scene: "B5", label: "공유할 지식 선택하기" };
  else if (scene === "B5" && shared) next = { scene: "C1", label: "운영자 화면에서 제안 검토" };
  else if (scene === "C1" && run.credits.some(item => item.amount > 0)) {
    const credited = run.credits.findLast(item => item.amount > 0)!;
    next = { scene: "C4", label: `${credited.author}의 크레딧 확인`, href: demoHref(`/audit/ledger?author=${encodeURIComponent(credited.authorId)}`, run.id) };
  }
  else if (scene === "C1" && run.board.entries.some(item => item.status === "approved")) next = { scene: "C2", label: "검토한 제안으로 배치 만들기" };
  else if (scene === "C3" && batch?.status === "complete") next = { scene: "C4", label: "세무사 화면에서 크레딧 확인" };
  else if (scene === "C4" && run.kbVersion > 0) next = { scene: "C5", label: "고객 화면에서 공통 AI 확인" };
  return {
    role, scene,
    actIndex: demoActs.findIndex(act => act.id === scene[0]),
    completedActs: [run.completed, shared, run.kbVersion > 0 && !!run.commonQuery],
    next: next && { ...next, href: next.href ?? scenePath(run, next.scene) },
    roles: [
      { id: "customer", label: "고객 화면", href: `/chat/clinic?c=${run.conversationId}` },
      { id: "expert", label: "세무사 화면", href: "/audit/consultations?kind=participation" },
      { id: "admin", label: "운영자 화면", href: "/admin/knowledge-contributions" },
    ],
  };
}
