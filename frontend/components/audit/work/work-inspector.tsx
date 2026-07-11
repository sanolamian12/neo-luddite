"use client";

import { useMemo, useState } from "react";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, Send } from "lucide-react";
import type { Conversation } from "@/lib/conversation-schema";
import type { Audit } from "@/lib/poc-schema";
import { evaluationFor, useAuditStore } from "@/lib/audit-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { LineFeedbackPanel } from "../line-feedback-panel";
import { SessionEvalPanel } from "../session-eval-panel";
import * as auditService from "@/services/audit";

type TabValue = "feedback" | "evaluation" | "submit";

/**
 * Work 워크스페이스의 우측 인스펙터 — 탭 3종 (피드백 · 평가 · 제출).
 * "근거" 탭은 P2 에서 "제출" 탭으로 교체됨 (Tier 2 근거는 추후 별 트랙).
 */
export function WorkInspector({
  audit,
  conversation,
  mobileShow = false,
}: {
  audit: Audit;
  conversation: Conversation;
  /** 모바일(<md)에서 이 패널을 탭으로 노출할지. 데스크톱은 항상 표시. */
  mobileShow?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);

  // 접힘(데스크톱) — 좁은 바 + 펼치기 버튼. 좌측 큐 스트립과 대칭.
  if (collapsed && !mobileShow) {
    return (
      <aside className="hidden w-12 shrink-0 flex-col border-l md:flex">
        <Button
          variant="ghost"
          size="icon-sm"
          className="m-2"
          onClick={() => setCollapsed(false)}
          aria-label="검수 패널 펼치기"
        >
          <ChevronLeft />
        </Button>
      </aside>
    );
  }

  return (
    <aside
      className={cn(
        "w-full shrink-0 flex-col overflow-hidden border-l md:flex md:w-[380px]",
        mobileShow ? "flex" : "hidden md:flex",
      )}
    >
      <TabsPrimitive.Root
        defaultValue={"feedback" satisfies TabValue}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <div className="flex shrink-0 items-stretch border-b">
          <Button
            variant="ghost"
            size="icon-sm"
            className="m-1 hidden shrink-0 md:inline-flex"
            onClick={() => setCollapsed(true)}
            aria-label="검수 패널 접기"
          >
            <ChevronRight />
          </Button>
          <TabsPrimitive.List className="flex flex-1">
            <TabTrigger value="feedback">피드백</TabTrigger>
            <TabTrigger value="evaluation">평가</TabTrigger>
            <TabTrigger value="submit">제출</TabTrigger>
          </TabsPrimitive.List>
        </div>

        <TabsPrimitive.Panel
          value="feedback"
          className="flex-1 overflow-y-auto p-4"
        >
          <LineFeedbackPanel
            conversationId={audit.conversationId}
            conversation={conversation}
          />
        </TabsPrimitive.Panel>

        <TabsPrimitive.Panel
          value="evaluation"
          className="flex-1 overflow-y-auto p-4"
        >
          <SessionEvalPanel conversationId={audit.conversationId} />
        </TabsPrimitive.Panel>

        <TabsPrimitive.Panel
          value="submit"
          className="flex-1 overflow-y-auto p-4"
        >
          <SubmitPanel audit={audit} conversation={conversation} />
        </TabsPrimitive.Panel>
      </TabsPrimitive.Root>
    </aside>
  );
}

function TabTrigger({
  value,
  children,
}: {
  value: TabValue;
  children: React.ReactNode;
}) {
  return (
    <TabsPrimitive.Tab
      value={value}
      className={cn(
        "flex-1 px-3 py-2 text-sm text-muted-foreground transition outline-none",
        "hover:text-foreground focus-visible:bg-muted",
        "data-selected:border-b-2 data-selected:border-foreground data-selected:font-medium data-selected:text-foreground",
      )}
    >
      {children}
    </TabsPrimitive.Tab>
  );
}

function SubmitPanel({
  audit,
  conversation,
}: {
  audit: Audit;
  conversation: Conversation;
}) {
  const router = useRouter();
  const feedback = useAuditStore((s) => s.feedback);
  const evaluations = useAuditStore((s) => s.evaluations);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assistantSegments = useMemo(() => {
    return conversation.messages
      .filter((m) => m.role === "assistant")
      .flatMap((m) => m.segments);
  }, [conversation]);

  const totalSegments = assistantSegments.length;
  const feedbackSegments = useMemo(() => {
    const set = new Set<string>();
    for (const f of feedback) {
      if (f.conversationId === audit.conversationId) set.add(f.segmentId);
    }
    return set;
  }, [feedback, audit.conversationId]);

  const coverage = feedbackSegments.size; // 별도 "이상 없음" 마킹은 v1 에 없음
  const hasSessionEval = Boolean(
    evaluationFor(evaluations, audit.conversationId, audit.auditorId),
  );
  const hasAnyFeedback = feedback.some(
    (f) => f.conversationId === audit.conversationId,
  );

  const checks: { ok: boolean; label: string; hint?: string }[] = [
    {
      ok: hasAnyFeedback,
      label: "라인 피드백 최소 1건 작성",
      hint: hasAnyFeedback
        ? `${feedback.filter((f) => f.conversationId === audit.conversationId).length}건 작성됨`
        : "전사에서 문장을 선택해 피드백을 남기세요",
    },
    {
      ok: hasSessionEval,
      label: "세션 평가 작성",
      hint: hasSessionEval ? "작성 완료" : "[평가] 탭에서 점수·코멘트 작성",
    },
  ];

  const allGood = checks.every((c) => c.ok);
  const isSubmitted = audit.status !== "draft" && audit.status !== "cancelled";

  const onSubmit = async () => {
    setError(null);
    if (!allGood) {
      setError("체크리스트를 먼저 완료해 주세요.");
      return;
    }
    setSubmitting(true);
    try {
      await auditService.submit(audit.id);
      // 진행도 갱신
      await auditService.patchProgress(audit.id, {
        feedbackCount: feedback.filter(
          (f) => f.conversationId === audit.conversationId,
        ).length,
        hasSessionEval,
        totalSegments,
      });
      router.push(`/audit/results`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-emerald-500" />
            <h2 className="text-sm font-semibold">이미 제출된 작업입니다</h2>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            현재 상태: <Badge variant="secondary">{audit.status}</Badge>
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            검수 결과는 완료 화면에서 확인할 수 있습니다.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => router.push("/audit/results")}
        >
          완료 화면으로 가기
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <section>
        <h2 className="text-sm font-semibold">제출 전 확인</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          제출 후에는 수정할 수 없습니다. 모든 항목을 확인하세요.
        </p>
      </section>

      <ul className="flex flex-col gap-2">
        {checks.map((c, i) => (
          <li
            key={i}
            className={cn(
              "flex items-start gap-2 rounded-md border px-3 py-2",
              c.ok ? "bg-emerald-50 border-emerald-200" : "bg-card",
            )}
          >
            {c.ok ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            ) : (
              <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            )}
            <div className="flex-1">
              <p className="text-sm">{c.label}</p>
              {c.hint && (
                <p className="text-xs text-muted-foreground">{c.hint}</p>
              )}
            </div>
          </li>
        ))}
      </ul>

      <section className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">전사 커버리지</span>
          <span className="tabular-nums">
            {coverage} / {totalSegments} 문장
          </span>
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">
          assistant 문장 중 피드백이 달린 비율. v1 은 미달 시에도 제출 가능.
        </p>
      </section>

      <section>
        <label className="text-xs font-medium text-muted-foreground">
          평가자 메모 (선택)
        </label>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="전체 평가나 검수자에게 전할 메모"
          rows={3}
          className="mt-1"
        />
        <p className="mt-1 text-[10px] text-muted-foreground">
          (v1 에서는 메모가 별도 저장되지 않습니다 — UI placeholder)
        </p>
      </section>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <Button
        onClick={onSubmit}
        disabled={!allGood || submitting}
        className="w-full"
      >
        <Send className="size-3.5" />
        {submitting ? "제출 중…" : "제출하기"}
      </Button>
    </div>
  );
}
