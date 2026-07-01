"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuditWorkStore, useAuditWorkHydrated } from "@/lib/audit-work-store";
import { useAuditStore, useAuditHydrated } from "@/lib/audit-store";
import { getConversation } from "@/lib/load-conversation";
import { cn } from "@/lib/utils";
import type { Audit, AuditStatus } from "@/lib/poc-schema";

type Filter = "all" | "draft" | "submitted";

const STATUS_META: Record<
  AuditStatus,
  { label: string; dot: string }
> = {
  draft: { label: "작성중", dot: "bg-amber-500" },
  submitted: { label: "제출", dot: "bg-emerald-500" },
  reviewed: { label: "검수", dot: "bg-blue-500" },
  finalized: { label: "확정", dot: "bg-emerald-700" },
  cancelled: { label: "취소", dot: "bg-muted-foreground/40" },
};

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "draft", label: "작성중" },
  { id: "submitted", label: "제출됨" },
];

/**
 * Work 워크스페이스의 좌측 큐 스트립.
 * 현 평가자의 Audit 들만 노출 — Task 간 빠른 이동.
 */
export function WorkQueueStrip({
  currentAuditId,
  auditorId,
}: {
  currentAuditId: string;
  auditorId: string;
}) {
  const workHydrated = useAuditWorkHydrated();
  const auditHydrated = useAuditHydrated();
  const allAudits = useAuditWorkStore((s) => s.audits);
  const feedback = useAuditStore((s) => s.feedback);
  const [filter, setFilter] = useState<Filter>("all");
  const [collapsed, setCollapsed] = useState(false);

  const items = useMemo(() => {
    if (!workHydrated) return [];
    return allAudits
      .filter((a) => a.auditorId === auditorId)
      .sort((a, b) => b.pickedAt - a.pickedAt)
      .map((a) => {
        const conv = getConversation(a.conversationId);
        const count = auditHydrated
          ? feedback.filter((f) => f.conversationId === a.conversationId).length
          : 0;
        return { audit: a, conv, feedbackCount: count };
      });
  }, [allAudits, auditorId, feedback, workHydrated, auditHydrated]);

  const visible = items.filter((it) => {
    if (filter === "all") return true;
    if (filter === "draft") return it.audit.status === "draft";
    if (filter === "submitted")
      return (
        it.audit.status === "submitted" ||
        it.audit.status === "reviewed" ||
        it.audit.status === "finalized"
      );
    return true;
  });

  if (collapsed) {
    return (
      <aside className="hidden w-12 shrink-0 flex-col border-r md:flex">
        <Button
          variant="ghost"
          size="icon-sm"
          className="m-2"
          onClick={() => setCollapsed(false)}
          aria-label="큐 스트립 펼치기"
        >
          <ChevronRight />
        </Button>
        <ul className="flex flex-col gap-1 px-1.5">
          {visible.map((it) => (
            <li key={it.audit.id}>
              <Link
                href={`/audit/work/${it.audit.id}`}
                className={cn(
                  "flex size-9 items-center justify-center rounded-md border text-xs",
                  it.audit.id === currentAuditId
                    ? "border-foreground bg-foreground/5"
                    : "border-transparent hover:bg-muted",
                )}
                title={`${it.conv?.topic.title ?? it.audit.conversationId}`}
              >
                <span
                  className={cn(
                    "size-2 rounded-full",
                    STATUS_META[it.audit.status].dot,
                  )}
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      </aside>
    );
  }

  return (
    <aside className="hidden w-[240px] shrink-0 flex-col border-r md:flex">
      <div className="flex items-center justify-between gap-1 border-b px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">진행중</span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setCollapsed(true)}
          aria-label="큐 스트립 접기"
        >
          <ChevronLeft />
        </Button>
      </div>

      <div className="flex gap-1 border-b px-2 py-2">
        {FILTERS.map((f) => (
          <Button
            key={f.id}
            type="button"
            size="xs"
            variant={filter === f.id ? "default" : "outline"}
            onClick={() => setFilter(f.id)}
            className="flex-1 px-2"
          >
            {f.label}
          </Button>
        ))}
      </div>

      <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {visible.length === 0 && (
          <li className="px-2 py-3 text-xs text-muted-foreground">
            해당 상태의 작업이 없습니다.
          </li>
        )}
        {visible.map((it) => {
          const active = it.audit.id === currentAuditId;
          const meta = STATUS_META[it.audit.status];
          return (
            <li key={it.audit.id}>
              <Link
                href={`/audit/work/${it.audit.id}`}
                className={cn(
                  "flex flex-col gap-1 rounded-md border px-2 py-1.5 text-left transition outline-none",
                  active
                    ? "border-foreground bg-foreground/5"
                    : "border-transparent hover:bg-muted focus-visible:bg-muted",
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn("size-2 shrink-0 rounded-full", meta.dot)}
                    aria-hidden
                  />
                  <span className="line-clamp-1 flex-1 text-sm font-medium">
                    {it.conv?.topic.title ?? it.audit.conversationId}
                  </span>
                  {it.feedbackCount > 0 && (
                    <Badge variant="secondary" className="text-[10px]">
                      {it.feedbackCount}
                    </Badge>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {it.conv?.topic.taxCategory ?? "—"} · {meta.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
