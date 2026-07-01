"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  conversationStatus,
  feedbackCounts,
  useAuditHydrated,
  useAuditStore,
  type ConversationStatus,
} from "@/lib/audit-store";
import { conversations, getConversation } from "@/lib/load-conversation";
import { cn } from "@/lib/utils";

type Filter = "all" | "in_progress" | "completed";

const STATUS_META: Record<
  ConversationStatus,
  { label: string; dot: string; badgeClass: string }
> = {
  untouched: {
    label: "미검토",
    dot: "bg-muted-foreground/40",
    badgeClass: "bg-muted text-muted-foreground",
  },
  in_progress: {
    label: "검토중",
    dot: "bg-amber-500",
    badgeClass: "bg-amber-100 text-amber-800",
  },
  completed: {
    label: "완료",
    dot: "bg-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-800",
  },
};

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "in_progress", label: "검토중" },
  { id: "completed", label: "완료" },
];

/**
 * 3-pane 워크스페이스의 좌측 큐 스트립. 동일 페르소나가 아닌 **전체** 세션 노출
 * (평가자는 occupation 무관). 상태 배지·필터·접기 토글 제공.
 */
export function QueueStrip({ currentId }: { currentId: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [collapsed, setCollapsed] = useState(false);
  const feedback = useAuditStore((s) => s.feedback);
  const evaluations = useAuditStore((s) => s.evaluations);
  const hydrated = useAuditHydrated();

  const items = useMemo(() => {
    return Object.keys(conversations).map((key) => {
      const conv = getConversation(key)!;
      const status = hydrated
        ? conversationStatus({ feedback, evaluations }, key)
        : "untouched";
      const count = hydrated
        ? Object.values(feedbackCounts(feedback, key)).reduce(
            (a, b) => a + b,
            0,
          )
        : 0;
      return { key, conv, status, count };
    });
  }, [feedback, evaluations, hydrated]);

  const visible = items.filter((it) =>
    filter === "all" ? true : it.status === filter,
  );

  if (collapsed) {
    return (
      <aside className="hidden w-12 shrink-0 flex-col border-r md:flex">
        <Button
          variant="ghost"
          size="icon-sm"
          className="m-2"
          onClick={() => setCollapsed(false)}
          aria-label="큐 스트립 펼치기"
          title="세션 큐 펼치기"
        >
          <ChevronRight />
        </Button>
        <ul className="flex flex-col gap-1 px-1.5">
          {visible.map((it) => (
            <li key={it.key}>
              <Link
                href={`/audit/chat-logs/${it.key}`}
                className={cn(
                  "flex size-9 items-center justify-center rounded-md border text-xs",
                  it.key === currentId
                    ? "border-foreground bg-foreground/5"
                    : "border-transparent hover:bg-muted",
                )}
                title={`${it.conv.topic.title} · ${STATUS_META[it.status].label}`}
              >
                <span
                  className={cn("size-2 rounded-full", STATUS_META[it.status].dot)}
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
    <aside className="hidden w-[220px] shrink-0 flex-col border-r md:flex">
      <div className="flex items-center justify-between gap-1 border-b px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          세션 큐
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setCollapsed(true)}
          aria-label="큐 스트립 접기"
          title="세션 큐 접기"
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
            해당 상태의 세션이 없습니다.
          </li>
        )}
        {visible.map((it) => {
          const active = it.key === currentId;
          const meta = STATUS_META[it.status];
          return (
            <li key={it.key}>
              <Link
                href={`/audit/chat-logs/${it.key}`}
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
                    {it.conv.topic.title}
                  </span>
                  {it.count > 0 && (
                    <Badge variant="secondary" className="text-[10px]">
                      {it.count}
                    </Badge>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {it.conv.topic.taxCategory} · {meta.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
