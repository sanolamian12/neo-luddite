"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useConversationHydrated,
  useConversationStore,
} from "@/lib/conversation-store";
import { useAuditTaskStore } from "@/lib/audit-task-store";
import { getConversation } from "@/lib/load-conversation";
import { getOccupation } from "@/lib/occupations";
import * as conversationService from "@/services/conversation";
import { formatDateTime } from "@/lib/poc-format";
import { middleTruncate } from "@/lib/utils";

export function PoolDetailView({ conversationId }: { conversationId: string }) {
  const hydrated = useConversationHydrated();
  const records = useConversationStore((s) => s.records);
  const allTasks = useAuditTaskStore((s) => s.tasks);
  const record = useMemo(
    () => records.find((c) => c.id === conversationId),
    [records, conversationId],
  );
  const tasks = useMemo(
    () => allTasks.filter((t) => t.conversationIds.includes(conversationId)),
    [allTasks, conversationId],
  );
  // 정지 스냅샷 원문(감사/일감이 읽는 것과 동일).
  const conv = getConversation(conversationId);

  if (!hydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>;
  }
  if (!record) {
    return (
      <div className="px-6 py-10">
        <h1 className="text-2xl font-bold">상담을 찾을 수 없습니다</h1>
        <p className="mt-2 text-sm">
          <Link className="underline" href="/admin/pool">
            ← 하차장으로 돌아가기
          </Link>
        </p>
      </div>
    );
  }

  const occ = getOccupation(record.occupation);
  const title = record.title ?? conv?.topic.title ?? record.id;
  const excluded = record.excludedAt != null;
  const assigned = tasks.length > 0;

  return (
    <div className="flex flex-col gap-6 px-6 py-6 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-mono text-xs text-muted-foreground">
            <span title={conversationId}>{middleTruncate(conversationId)}</span>
          </p>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">
              {occ ? `${occ.emoji} ${occ.label}` : record.occupation}
            </Badge>
            <Badge variant={excluded ? "ghost" : assigned ? "secondary" : "default"}>
              {excluded ? "제외" : assigned ? "배정됨" : "신규"}
            </Badge>
            <span>소유자 {record.ownerLabel ?? record.ownerId}</span>
            <span>·</span>
            <span>{record.turnCount} turns</span>
            <span>·</span>
            <span>생성 {formatDateTime(record.createdAt)}</span>
            {record.snapshotAt != null && (
              <>
                <span>·</span>
                <span>사진 {formatDateTime(record.snapshotAt)}</span>
              </>
            )}
          </div>
        </div>
        <Link href="/admin/pool" className="text-sm underline">
          ← 하차장
        </Link>
      </div>

      {tasks.length > 0 && (
        <section className="rounded-xl border bg-card">
          <header className="border-b px-4 py-2 text-sm font-semibold">포함된 Task</header>
          <ul className="divide-y text-sm">
            {tasks.map((t) => (
              <li key={t.id} className="px-4 py-2">
                <Link href={`/admin/tasks/${t.id}`} className="font-mono text-xs hover:underline" title={t.id}>
                  {middleTruncate(t.id)}
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
            <span>정지 스냅샷 미리보기</span>
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

      <div className="flex flex-wrap items-center gap-2">
        {excluded ? (
          <Button variant="ghost" onClick={() => conversationService.setExcluded(conversationId, false)}>
            제외 복원
          </Button>
        ) : (
          <Button variant="ghost" onClick={() => conversationService.setExcluded(conversationId, true)}>
            제외 처리
          </Button>
        )}
        <Button
          disabled={excluded}
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
