import type { ExpertCard } from "../poc-schema";

const portraits: Record<string, string> = {
  "demo-expert-1": "/demo/experts/yun-seojin.png",
  "demo-expert-2": "/demo/experts/kim-dohyeon.png",
  "demo-expert-3": "/demo/experts/lee-sumin.png",
};

/** Also decorates runs saved before portraits were added, without changing their knowledge. */
export function withDemoPortrait(expert: ExpertCard): ExpertCard {
  return { ...expert, avatarUrl: expert.avatarUrl || portraits[expert.auditorId] };
}
