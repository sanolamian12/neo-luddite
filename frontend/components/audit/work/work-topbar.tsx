"use client";

import { Download } from "lucide-react";
import Link from "next/link";
import type { Conversation } from "@/lib/conversation-schema";
import type { Audit } from "@/lib/poc-schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { evaluationFor, useAuditHydrated, useAuditStore } from "@/lib/audit-store";
import { useAuditTaskStore } from "@/lib/audit-task-store";
import { getOccupation } from "@/lib/occupations";
import { middleTruncate } from "@/lib/utils";
import {
  formatDate,
  formatRemaining,
  AUDIT_STATUS_LABEL,
  auditStatusVariant,
} from "@/lib/poc-format";

/**
 * Work 워크스페이스 상단 — Audit / Task / 마감 / 내보내기.
 */
export function WorkTopbar({
  audit,
  conversation,
}: {
  audit: Audit;
  conversation: Conversation;
}) {
  const hydrated = useAuditHydrated();
  const feedback = useAuditStore((s) => s.feedback);
  const evaluations = useAuditStore((s) => s.evaluations);
  const tasks = useAuditTaskStore((s) => s.tasks);

  const items = feedback.filter((f) => f.conversationId === audit.conversationId);
  const evaluation = evaluationFor(evaluations, audit.conversationId, audit.auditorId);
  const occ = getOccupation(conversation.persona.occupation);
  const task = tasks.find((t) => t.id === audit.taskId);

  const onExport = () => {
    const data = {
      auditId: audit.id,
      taskId: audit.taskId,
      conversationId: audit.conversationId,
      feedback: items,
      evaluation,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-${audit.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p
            className="truncate font-mono text-xs text-muted-foreground"
            title={audit.id}
          >
            {middleTruncate(audit.id)}
          </p>
          {task && (
            <Link
              href={`/admin/tasks/${task.id}`}
              className="shrink-0 font-mono text-xs text-muted-foreground hover:underline"
              title={`Task 상세: ${task.id}`}
            >
              ← {middleTruncate(task.id)}
            </Link>
          )}
        </div>
        <h1 className="truncate text-base font-semibold leading-tight">
          {conversation.topic.title}
        </h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {occ ? `${occ.emoji} ${occ.label}` : conversation.persona.label}
          {" · "}
          {conversation.topic.taxCategory}
          {task && (
            <>
              {" · 마감 "}
              {formatDate(task.deadline)} ({formatRemaining(task.deadline)})
            </>
          )}
        </p>
      </div>

      {hydrated && (
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary" className="text-[10px]">
            피드백 {items.length}
          </Badge>
          <Badge variant={auditStatusVariant(audit.status)} className="text-[10px]">
            {AUDIT_STATUS_LABEL[audit.status]}
          </Badge>
        </div>
      )}

      <Button
        size="sm"
        variant="outline"
        onClick={onExport}
        className="shrink-0"
      >
        <Download className="size-3.5" />
        <span className="hidden md:inline">내보내기</span>
      </Button>
    </header>
  );
}
