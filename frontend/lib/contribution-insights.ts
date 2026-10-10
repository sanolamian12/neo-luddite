import type { ContributionBoard } from "./knowledge-contributions";

export type KnowledgeCredit = { id: string; contributionId: string; revision: number; authorId: string; author: string; amount: number; at: string; kbVersion: number; batchId: string; reversalOf?: string };

/** A presentation projection of local approvals; never writes to the service ledger. */
export function localKnowledgeCredits(board: ContributionBoard): KnowledgeCredit[] {
  return board.entries.flatMap(entry => {
    if (!entry.publication || !entry.credit) return [];
    const accepted: KnowledgeCredit = { id: entry.credit.id, contributionId: entry.id, revision: entry.publication.revision, authorId: entry.author.id, author: entry.author.name, amount: 1, at: entry.publication.at, kbVersion: entry.publication.version, batchId: entry.publication.id };
    if (entry.credit.status !== "reversed") return [accepted];
    return [accepted, { ...accepted, id: `reversal:${accepted.id}`, reversalOf: accepted.id, amount: -1, at: entry.history.findLast(event => event.type === "retracted")?.at ?? entry.credit.at }];
  });
}

export function summarizeCredits(credits: readonly KnowledgeCredit[], since = 0) {
  const unique = [...new Map(credits.map(item => [item.id, item])).values()].filter(item => Date.parse(item.at) >= since);
  const authors = new Map<string, { id: string; name: string; amount: number; accepted: number; reversed: number }>();
  for (const item of unique) {
    const row = authors.get(item.authorId) ?? { id: item.authorId, name: item.author, amount: 0, accepted: 0, reversed: 0 };
    row.amount += item.amount;
    row.accepted += item.amount > 0 ? 1 : 0;
    row.reversed += item.amount < 0 ? 1 : 0;
    authors.set(item.authorId, row);
  }
  const total = unique.reduce((sum, item) => sum + item.amount, 0);
  const positive = [...authors.values()].reduce((sum, item) => sum + Math.max(0, item.amount), 0);
  const contributors = [...authors.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "ko")).map(item => ({ ...item, share: positive > 0 ? Math.max(0, item.amount) / positive : 0 }));
  return { total, contributors, events: unique.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)) };
}
