"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePoolHydrated, usePoolStore } from "@/lib/pool-store";
import { useAuditTaskStore } from "@/lib/audit-task-store";
import { getConversation } from "@/lib/load-conversation";
import { getOccupation } from "@/lib/occupations";
import * as poolService from "@/services/pool";
import { formatDate, POOL_STATUS_LABEL } from "@/lib/poc-format";

export function PoolDetailView({ conversationId }: { conversationId: string }) {
  const hydrated = usePoolHydrated();
  const allCandidates = usePoolStore((s) => s.candidates);
  const allTasks = useAuditTaskStore((s) => s.tasks);
  const candidate = useMemo(
    () => allCandidates.find((c) => c.conversationId === conversationId),
    [allCandidates, conversationId],
  );
  const tasks = useMemo(
    () => allTasks.filter((t) => t.conversationIds.includes(conversationId)),
    [allTasks, conversationId],
  );
  const conv = getConversation(conversationId);

  if (!hydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>;
  }
  if (!candidate) {
    return (
      <div className="px-6 py-10">
        <h1 className="text-2xl font-bold">후보를 찾을 수 없습니다</h1>
        <p className="mt-2 text-sm">
          <Link className="underline" href="/admin/pool">
            ← 풀로 돌아가기
          </Link>
        </p>
      </div>
    );
  }

  const occ = getOccupation(candidate.occupation);

  return (
    <div className="flex flex-col gap-6 px-6 py-6 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-mono text-xs text-muted-foreground">{conversationId}</p>
          <h1 className="text-2xl font-bold tracking-tight">
            {conv?.topic.title ?? candidate.topic ?? "(토픽 미상)"}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">
              {occ ? `${occ.emoji} ${occ.label}` : candidate.occupation}
            </Badge>
            <Badge variant="secondary">{POOL_STATUS_LABEL[candidate.status]}</Badge>
            <span>{candidate.turnCount} turns</span>
            <span>·</span>
            <span>추가일 {formatDate(candidate.addedAt)}</span>
          </div>
          {candidate.firstUserMessage && (
            <p className="mt-2 text-sm">{candidate.firstUserMessage}</p>
          )}
        </div>
        <Link href="/admin/pool" className="text-sm underline">
          ← 풀
        </Link>
      </div>

      {tasks.length > 0 && (
        <section className="rounded-xl border bg-card">
          <header className="border-b px-4 py-2 text-sm font-semibold">포함된 Task</header>
          <ul className="divide-y text-sm">
            {tasks.map((t) => (
              <li key={t.id} className="px-4 py-2">
                <Link href={`/admin/tasks/${t.id}`} className="font-mono text-xs hover:underline">
                  {t.id}
                </Link>
                <span className="ml-2 text-muted-foreground">{t.label}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {conv && (
        <section className="rounded-xl border bg-card">
          <header className="flex items-center justify-between border-b px-4 py-2 text-sm font-semibold">
            <span>전사 미리보기</span>
            <Link
              href={`/audit/chat-logs/${encodeURIComponent(conversationId)}`}
              className="text-xs font-normal text-muted-foreground hover:underline"
            >
              감사 워크스페이스에서 보기 →
            </Link>
          </header>
          <ul className="divide-y text-sm">
            {conv.messages.slice(0, 6).map((m) => (
              <li key={m.id} className="px-4 py-2">
                <span className="mr-2 font-mono text-xs uppercase text-muted-foreground">
                  {m.role}
                </span>
                <span className="whitespace-pre-wrap">{m.segments.map((s) => s.text).join(" ")}</span>
              </li>
            ))}
            {conv.messages.length > 6 && (
              <li className="px-4 py-2 text-xs text-muted-foreground">
                … 나머지 {conv.messages.length - 6}개
              </li>
            )}
          </ul>
        </section>
      )}

      <div className="flex items-center gap-2">
        {candidate.status === "new" && (
          <Button
            variant="ghost"
            onClick={() => poolService.exclude(conversationId)}
          >
            제외 처리
          </Button>
        )}
        <Button
          render={
            <Link
              href={`/admin/tasks/new?conversationIds=${encodeURIComponent(conversationId)}`}
            />
          }
        >
          이 대화로 Task 만들기
        </Button>
      </div>
    </div>
  );
}
