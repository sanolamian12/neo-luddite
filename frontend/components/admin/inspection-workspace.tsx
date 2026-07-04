"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuditWorkHydrated, useAuditWorkStore } from "@/lib/audit-work-store";
import { evaluationFor, useAuditStore, useAuditHydrated } from "@/lib/audit-store";
import { useReviewStore, useReviewHydrated } from "@/lib/review-store";
import { useAuditTaskStore } from "@/lib/audit-task-store";
import { useInquiryStore } from "@/lib/inquiry-store";
import { useAccountStore } from "@/lib/account-store";
import { getConversation } from "@/lib/load-conversation";
import { getOccupation } from "@/lib/occupations";
import { FEEDBACK_TAG_LABELS } from "@/lib/audit-schema";
import {
  AUDIT_STATUS_LABEL,
  auditStatusVariant,
  formatDate,
  formatRemaining,
  formatDateTime,
} from "@/lib/poc-format";
import { cn } from "@/lib/utils";
import * as reviewService from "@/services/review";

type Decision = "pending" | "accepted" | "rejected";

export function InspectionWorkspace({ auditId }: { auditId: string }) {
  const router = useRouter();
  const workHydrated = useAuditWorkHydrated();
  const auditHydrated = useAuditHydrated();
  const reviewHydrated = useReviewHydrated();
  const audits = useAuditWorkStore((s) => s.audits);
  const tasks = useAuditTaskStore((s) => s.tasks);
  const allFeedback = useAuditStore((s) => s.feedback);
  const evaluations = useAuditStore((s) => s.evaluations);
  const reviews = useReviewStore((s) => s.reviews);
  const inquiries = useInquiryStore((s) => s.inquiries);
  const adminId = useAccountStore((s) => s.admin.id);

  const audit = useMemo(
    () => audits.find((a) => a.id === auditId),
    [audits, auditId],
  );
  const conv = audit ? getConversation(audit.conversationId) : null;
  const task = audit ? tasks.find((t) => t.id === audit.taskId) : null;
  const review = useMemo(
    () => reviews.find((r) => r.auditId === auditId) ?? null,
    [reviews, auditId],
  );
  const auditFeedback = useMemo(
    () =>
      audit
        ? allFeedback.filter((f) => f.conversationId === audit.conversationId)
        : [],
    [allFeedback, audit],
  );
  const evaluation = audit
    ? evaluationFor(evaluations, audit.conversationId, audit.auditorId)
    : null;
  const relatedInquiries = useMemo(
    () => inquiries.filter((q) => q.auditId === auditId),
    [inquiries, auditId],
  );

  const [selectedFeedbackId, setSelectedFeedbackId] = useState<string | null>(
    null,
  );
  const [reasonText, setReasonText] = useState("");
  const [overallNote, setOverallNote] = useState("");
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // review 객체 자동 생성 (draft 진입)
  useEffect(() => {
    if (!audit || !workHydrated || !reviewHydrated) return;
    if (audit.status !== "submitted") return;
    if (review) return;
    void reviewService.startOrGet(audit.id, adminId);
  }, [audit, review, workHydrated, reviewHydrated, adminId]);

  // 첫 피드백 자동 선택
  useEffect(() => {
    if (!selectedFeedbackId && auditFeedback.length > 0) {
      setSelectedFeedbackId(auditFeedback[0].id);
    }
  }, [auditFeedback, selectedFeedbackId]);

  // 선택된 피드백의 이전 결정 사유로 reason 시드
  useEffect(() => {
    if (!review || !selectedFeedbackId) {
      setReasonText("");
      return;
    }
    const d = review.decisions.find((x) => x.feedbackId === selectedFeedbackId);
    setReasonText(d?.reason ?? "");
  }, [review, selectedFeedbackId]);

  useEffect(() => {
    if (review?.overallNote) setOverallNote(review.overallNote);
  }, [review?.overallNote]);

  if (!workHydrated || !auditHydrated || !reviewHydrated) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        로딩 중…
      </div>
    );
  }

  if (!audit || !conv) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2">
        <p className="text-sm">Audit 을 찾을 수 없습니다.</p>
        <Link href="/admin/inspection" className="text-sm underline">
          검수 큐로
        </Link>
      </div>
    );
  }

  const isFinalized = review?.status === "finalized";
  const readonly = audit.status !== "submitted";

  // 통계
  const decisionMap = new Map<string, Decision>();
  for (const d of review?.decisions ?? []) {
    decisionMap.set(d.feedbackId, d.accepted ? "accepted" : "rejected");
  }
  const totalFb = auditFeedback.length;
  const acceptedCount = auditFeedback.filter(
    (f) => (decisionMap.get(f.id) ?? "pending") === "accepted",
  ).length;
  const rejectedCount = auditFeedback.filter(
    (f) => decisionMap.get(f.id) === "rejected",
  ).length;
  const pendingCount = totalFb - acceptedCount - rejectedCount;
  const canFinalize = totalFb > 0 && pendingCount === 0;

  const onDecide = async (
    feedbackId: string,
    accepted: boolean,
    reason?: string,
  ) => {
    if (!review || readonly || isFinalized) return;
    await reviewService.setDecision(review.id, {
      feedbackId,
      accepted,
      reason: accepted ? undefined : reason,
      decidedAt: Date.now(),
    });
  };

  const onAcceptAll = async () => {
    if (!review || readonly || isFinalized) return;
    for (const f of auditFeedback) {
      await reviewService.setDecision(review.id, {
        feedbackId: f.id,
        accepted: true,
        decidedAt: Date.now(),
      });
    }
  };

  const onFinalize = async () => {
    if (!review || finalizing) return;
    setError(null);
    if (overallNote.trim() && overallNote !== review.overallNote) {
      await reviewService.setOverallNote(review.id, overallNote.trim());
    }
    setFinalizing(true);
    try {
      await reviewService.finalize(review.id);
      router.push(`/admin/inspection/${auditId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFinalizing(false);
    }
  };

  const occ = getOccupation(conv.persona.occupation);
  const selectedFeedback = auditFeedback.find(
    (f) => f.id === selectedFeedbackId,
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-mono text-xs text-muted-foreground">{audit.id}</p>
            {task && (
              <Link
                href={`/admin/tasks/${task.id}`}
                className="font-mono text-xs text-muted-foreground hover:underline"
              >
                ← {task.id}
              </Link>
            )}
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">평가자 {audit.auditorId}</span>
          </div>
          <h1 className="truncate text-base font-semibold leading-tight">
            {conv.topic.title}
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {occ ? `${occ.emoji} ${occ.label}` : conv.persona.label} ·{" "}
            {conv.topic.taxCategory} · 제출 {formatDate(audit.submittedAt)}
          </p>
        </div>
        <Badge variant={auditStatusVariant(audit.status)} className="text-[10px]">
          {AUDIT_STATUS_LABEL[audit.status]}
        </Badge>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* 전사 read-only */}
        <main className="min-w-0 flex-1 overflow-y-auto px-6 py-4">
          {conv.messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                "mb-3 rounded-lg border px-3 py-2",
                m.role === "assistant" ? "bg-card" : "bg-muted/50",
              )}
            >
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {m.role}
              </div>
              <div className="flex flex-col gap-1">
                {m.segments.map((s) => {
                  const segFb = auditFeedback.filter((f) => f.segmentId === s.id);
                  return (
                    <div key={s.id} className="flex flex-col gap-1">
                      <p className="text-sm leading-relaxed">{s.text}</p>
                      {segFb.length > 0 && (
                        <div className="flex flex-wrap gap-1 pl-3">
                          {segFb.map((f) => {
                            const dec = decisionMap.get(f.id) ?? "pending";
                            const isSelected = f.id === selectedFeedbackId;
                            return (
                              <button
                                key={f.id}
                                type="button"
                                onClick={() => setSelectedFeedbackId(f.id)}
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] transition outline-none",
                                  isSelected && "ring-2 ring-foreground/30",
                                  dec === "accepted" &&
                                    "border-emerald-300 bg-emerald-50 text-emerald-900",
                                  dec === "rejected" &&
                                    "border-rose-300 bg-rose-50 text-rose-900",
                                  dec === "pending" &&
                                    "border-amber-300 bg-amber-50 text-amber-900",
                                )}
                                title={f.body}
                              >
                                {dec === "accepted" && <CheckCircle2 className="size-3" />}
                                {dec === "rejected" && <XCircle className="size-3" />}
                                <span className="max-w-[200px] truncate">{f.body}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </main>

        {/* 인스펙터 — 결정 */}
        <aside className="hidden w-[380px] shrink-0 flex-col overflow-hidden border-l md:flex">
          <div className="flex shrink-0 border-b">
            <div className="flex-1 border-b-2 border-foreground px-3 py-2 text-sm font-medium">
              결정
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {selectedFeedback ? (
              <div className="flex flex-col gap-3">
                <section>
                  <h2 className="text-sm font-semibold">평가자 피드백</h2>
                  <p className="mt-1 rounded-md bg-muted px-2 py-1.5 text-xs">
                    {selectedFeedback.body}
                  </p>
                  {selectedFeedback.tags.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {selectedFeedback.tags.map((t) => (
                        <Badge key={t} variant="secondary" className="text-[10px]">
                          {FEEDBACK_TAG_LABELS[t]}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {selectedFeedback.reviewer}
                  </p>
                </section>

                <section>
                  <h3 className="text-sm font-semibold">결정</h3>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Button
                      variant={
                        decisionMap.get(selectedFeedback.id) === "accepted"
                          ? "default"
                          : "outline"
                      }
                      onClick={() => onDecide(selectedFeedback.id, true)}
                      disabled={readonly || isFinalized}
                    >
                      <CheckCircle2 className="size-3.5" />
                      인정
                    </Button>
                    <Button
                      variant={
                        decisionMap.get(selectedFeedback.id) === "rejected"
                          ? "default"
                          : "outline"
                      }
                      onClick={() => onDecide(selectedFeedback.id, false, reasonText.trim() || undefined)}
                      disabled={readonly || isFinalized}
                    >
                      <XCircle className="size-3.5" />
                      거절
                    </Button>
                  </div>
                  {decisionMap.get(selectedFeedback.id) === "rejected" && (
                    <div className="mt-2">
                      <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        거절 사유 (필수)
                      </label>
                      <Textarea
                        value={reasonText}
                        onChange={(e) => setReasonText(e.target.value)}
                        placeholder="이 피드백을 거절한 이유"
                        rows={2}
                        className="mt-1"
                        disabled={readonly || isFinalized}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-1"
                        onClick={() =>
                          onDecide(
                            selectedFeedback.id,
                            false,
                            reasonText.trim() || undefined,
                          )
                        }
                        disabled={readonly || isFinalized}
                      >
                        사유 저장
                      </Button>
                    </div>
                  )}
                </section>

                <section className="rounded-md border bg-muted/30 px-3 py-2">
                  <p className="text-xs text-muted-foreground">
                    피드백 {auditFeedback.findIndex((f) => f.id === selectedFeedback.id) + 1}
                    {" / "}
                    {auditFeedback.length}
                  </p>
                  <div className="mt-1 flex gap-1">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        const idx = auditFeedback.findIndex(
                          (f) => f.id === selectedFeedback.id,
                        );
                        if (idx > 0) setSelectedFeedbackId(auditFeedback[idx - 1].id);
                      }}
                    >
                      이전
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        const idx = auditFeedback.findIndex(
                          (f) => f.id === selectedFeedback.id,
                        );
                        if (idx < auditFeedback.length - 1)
                          setSelectedFeedbackId(auditFeedback[idx + 1].id);
                      }}
                    >
                      다음
                    </Button>
                  </div>
                </section>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                전사에서 피드백 chip 을 선택하세요.
              </p>
            )}
          </div>

          {/* 세션 평가 mini */}
          {evaluation && (
            <div className="border-t p-3">
              <h3 className="text-xs font-medium text-muted-foreground">세션 평가</h3>
              <div className="mt-1 flex gap-2 text-xs">
                <span>문장력 {evaluation.scores.writing}/5</span>
                <span>법률 {evaluation.scores.legalAccuracy}/5</span>
              </div>
              {evaluation.qualitative && (
                <p className="mt-1 text-xs text-muted-foreground line-clamp-3">
                  {evaluation.qualitative}
                </p>
              )}
            </div>
          )}
        </aside>
      </div>

      {/* 푸터 */}
      <footer className="flex shrink-0 items-center gap-3 border-t bg-card px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900">
            인정 {acceptedCount}
          </span>
          <span className="rounded-md bg-rose-100 px-2 py-0.5 text-xs text-rose-900">
            거절 {rejectedCount}
          </span>
          {pendingCount > 0 && (
            <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
              보류 {pendingCount}
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {!readonly && !isFinalized && (
            <Button variant="outline" onClick={onAcceptAll}>
              전체 인정
            </Button>
          )}
          {isFinalized ? (
            <div className="text-xs text-muted-foreground">
              검수 완료 · 이의 기간 종료{" "}
              {review?.disputeWindowEndsAt
                ? `(${formatDateTime(review.disputeWindowEndsAt)}, ${formatRemaining(review.disputeWindowEndsAt)})`
                : ""}
            </div>
          ) : (
            <Button onClick={onFinalize} disabled={!canFinalize || finalizing}>
              <Send className="size-3.5" />
              {finalizing ? "확정 중…" : "검수 완료"}
            </Button>
          )}
        </div>
      </footer>

      {/* overall note - bottom collapsable area */}
      {!isFinalized && !readonly && (
        <div className="shrink-0 border-t bg-muted/20 px-4 py-2">
          <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            전체 코멘트 (선택)
          </label>
          <Textarea
            value={overallNote}
            onChange={(e) => setOverallNote(e.target.value)}
            placeholder="평가자에게 전할 전체 총평"
            rows={2}
            className="mt-1"
          />
        </div>
      )}

      {error && (
        <div className="border-t border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {relatedInquiries.length > 0 && (
        <div className="shrink-0 border-t bg-amber-50 px-4 py-2 text-xs text-amber-900">
          ⚠ 이 audit 에 대한 이의제기 {relatedInquiries.length}건 ·{" "}
          <Link href="/admin/inquiries" className="underline">
            확인하기
          </Link>
        </div>
      )}
    </div>
  );
}
