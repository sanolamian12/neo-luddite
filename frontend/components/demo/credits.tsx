"use client";
import { expert } from "@/lib/demo/domain";
import type { LedgerEntry } from "@/lib/poc-schema";
import { EntriesTable } from "@/components/auditor/ledger-view";
import { DemoLink, useDemo } from "./runtime";
import css from "./demo.module.css";
export function DemoCredits() {
  const { run } = useDemo()!;
  const author = expert(run);
  const entries = run.credits.filter((credit) => credit.authorId === author.auditorId).reduce<LedgerEntry[]>((rows, credit) => [...rows, { id: credit.id, auditorId: credit.authorId, kind: credit.amount > 0 ? "contribution_accepted" : "adjustment", amount: credit.amount, balanceAfter: (rows.at(-1)?.balanceAfter ?? 0) + credit.amount, timestamp: new Date(credit.at).getTime(), sourceRef: { kind: "kb_contribution", contributionId: credit.contributionId, revision: credit.revision, batchId: credit.batchId, kbVersion: credit.kbVersion, author: credit.author } }], []).reverse();
  const balance = entries[0]?.balanceAfter ?? 0;
  return <div className="ds-page flex flex-col gap-6 overflow-auto"><header><h1 className="text-2xl font-semibold">기여 크레딧</h1><p className="mt-3">{author.displayName} · 누적 <strong className="text-2xl tabular-nums">{balance} cr</strong></p><p className={css.note}>반영된 제출본당 +1 cr · 시연용 기여 단위이며 현금 가치나 지급을 의미하지 않습니다.</p></header>
    <EntriesTable entries={entries} renderSource={(entry) => { const credit = run.credits.find((item) => item.id === entry.id)!; const contribution = run.board.entries.find((item) => item.id === credit.contributionId); return <div><DemoLink className="underline" href={`/audit/contributions?contribution=${credit.contributionId}`}>{contribution?.payload.title ?? "공유 지식"}</DemoLink><small className="block">{credit.author} · 제출본 {credit.revision} · 공통 지식 버전 {credit.kbVersion}</small><DemoLink className="underline" href={`/admin/knowledge-contributions/batches/${credit.batchId}`}>반영 배치 보기</DemoLink></div>; }} />
    <div className={css.actions}><DemoLink href="/audit/contributions">내 기여 내역</DemoLink><DemoLink href="/chat/clinic?common=1">업데이트된 공통 AI 확인 →</DemoLink></div>
  </div>;
}
