import type { Practice } from "./agent-practice";
import type { ContributionBoard } from "./knowledge-contributions";

/** Ephemeral retrieval overlay: shared publications never enter the editable personal library. */
export function withSharedKnowledge(practice: Practice, board: ContributionBoard): Practice {
  const shared = board.entries.flatMap((entry) => {
    if (entry.status !== "published" || !entry.publication) return [];
    const revision = entry.revisions.find((item) => item.number === entry.publication?.revision);
    if (!revision || revision.payload.kind === "question") return [];
    const payload = revision.payload;
    return [{ id: entry.publication.id, title: payload.title, facts: payload.facts, judgment: payload.judgment, conclusion: payload.conclusion, exceptions: payload.exceptions, keywords: payload.keywords, scope: payload.scope, enabled: true, priority: "standard" as const, origin: "sample" as const, community: { contributionId: entry.id, author: entry.author.name, version: entry.publication.version } }];
  });
  return { ...practice, cases: [...practice.cases.filter((entry) => !entry.community), ...shared] };
}
