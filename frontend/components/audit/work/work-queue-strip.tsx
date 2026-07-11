"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuditWorkStore, useAuditWorkHydrated } from "@/lib/audit-work-store";
import { useAuditStore, useAuditHydrated } from "@/lib/audit-store";
import { getConversation } from "@/lib/load-conversation";
import { cn, middleTruncate } from "@/lib/utils";
import type { Audit, AuditStatus } from "@/lib/poc-schema";

type Filter = "all" | "notStarted" | "draft" | "submitted";

/**
 * 도트 색은 오직 "내가 이 대화에 남긴 코멘트" 축만 표시한다(제출 여부는 별개 축 →
 * 하단 상태 라벨/제출됨 필터로 파악). 한 도트가 여러 축을 겸하면 혼동되므로 2-상태.
 *  · 회색 = 내 코멘트 0 (시작전)
 *  · 주황 = 내 코멘트 ≥1 (작성중)
 */
const NOT_STARTED_DOT = "bg-muted-foreground/40"; // 회색
const IN_PROGRESS_DOT = "bg-amber-500"; // 주황

const STATUS_META: Record<AuditStatus, { label: string }> = {
  draft: { label: "작성중" },
  submitted: { label: "제출" },
  reviewed: { label: "검수" },
  finalized: { label: "확정" },
  cancelled: { label: "취소" },
};

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "notStarted", label: "시작전" },
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
  mobileShow = false,
}: {
  currentAuditId: string;
  auditorId: string;
  /** 모바일(<md)에서 이 큐를 탭으로 노출할지. 데스크톱은 항상 표시. */
  mobileShow?: boolean;
}) {
  const workHydrated = useAuditWorkHydrated();
  const auditHydrated = useAuditHydrated();
  const allAudits = useAuditWorkStore((s) => s.audits);
  const feedback = useAuditStore((s) => s.feedback);
  const [filter, setFilter] = useState<Filter>("all");
  const [collapsed, setCollapsed] = useState(false);
  // 데스크톱에서 가로 크기 조절 — 최소 200px, 최대 스크린 절반.
  const [width, setWidth] = useState(240);
  const [dragging, setDragging] = useState(false);
  const asideRef = useRef<HTMLElement>(null);

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    const onMove = (ev: MouseEvent) => {
      const left = asideRef.current?.getBoundingClientRect().left ?? 0;
      const max = window.innerWidth / 2;
      setWidth(Math.min(Math.max(ev.clientX - left, 200), max));
    };
    const onUp = () => {
      setDragging(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const items = useMemo(() => {
    if (!workHydrated) return [];
    return allAudits
      .filter((a) => a.auditorId === auditorId)
      .sort((a, b) => b.pickedAt - a.pickedAt)
      .map((a) => {
        const conv = getConversation(a.conversationId);
        const forConv = auditHydrated
          ? feedback.filter((f) => f.conversationId === a.conversationId)
          : [];
        // 제목 옆 배지 = 이 대화의 총 코멘트(작성자 불문).
        const count = forConv.length;
        // 도트/시작전 판정 = 내가 남긴 코멘트만.
        const myCount = forConv.filter((f) => f.auditorId === auditorId).length;
        return { audit: a, conv, feedbackCount: count, myFeedbackCount: myCount };
      });
  }, [allAudits, auditorId, feedback, workHydrated, auditHydrated]);

  const visible = items.filter((it) => {
    if (filter === "all") return true;
    if (filter === "notStarted") return it.myFeedbackCount === 0;
    if (filter === "draft") return it.audit.status === "draft";
    if (filter === "submitted")
      return (
        it.audit.status === "submitted" ||
        it.audit.status === "reviewed" ||
        it.audit.status === "finalized"
      );
    return true;
  });

  if (collapsed && !mobileShow) {
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
                    it.myFeedbackCount === 0 ? NOT_STARTED_DOT : IN_PROGRESS_DOT,
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
    <aside
      ref={asideRef}
      style={{ "--queue-w": `${width}px` } as React.CSSProperties}
      className={cn(
        "relative w-full shrink-0 flex-col border-r md:flex md:w-[var(--queue-w)]",
        mobileShow ? "flex" : "hidden md:flex",
      )}
    >
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
            className="flex-1 px-1.5"
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
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      it.myFeedbackCount === 0
                        ? NOT_STARTED_DOT
                        : IN_PROGRESS_DOT,
                    )}
                    aria-hidden
                  />
                  <span className="line-clamp-1 flex-1 text-sm font-medium">
                    {it.conv?.topic.title ?? middleTruncate(it.audit.conversationId)}
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

      {/* 가로 크기 조절 핸들 — 데스크톱 전용 */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="큐 스트립 너비 조절"
        onMouseDown={startDrag}
        className={cn(
          "absolute -right-1 top-0 z-10 hidden h-full w-2 cursor-col-resize md:block",
          "transition-colors hover:bg-foreground/15",
          dragging && "bg-foreground/25",
        )}
      />
    </aside>
  );
}
