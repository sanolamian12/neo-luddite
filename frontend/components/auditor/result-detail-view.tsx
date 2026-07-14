"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, XCircle, MessageCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuditWorkHydrated, useAuditWorkStore } from "@/lib/audit-work-store";
import { useReviewStore, useReviewHydrated } from "@/lib/review-store";
import { reviewForAudit } from "@/lib/review-lookup";
import { useAuditStore } from "@/lib/audit-store";
import { useInquiryStore, useInquiryHydrated } from "@/lib/inquiry-store";
import { useAccountStore } from "@/lib/account-store";
import {
  useConversationHydrated,
  useConversationStore,
} from "@/lib/conversation-store";
import { getConversation } from "@/lib/load-conversation";
import { getOccupation } from "@/lib/occupations";
import { FEEDBACK_TAG_LABELS } from "@/lib/audit-schema";
import {
  AUDIT_STATUS_LABEL,
  auditStatusVariant,
  formatDate,
  formatDateTime,
} from "@/lib/poc-format";
import { cn, middleTruncate } from "@/lib/utils";
import * as reviewService from "@/services/review";
import * as inquiryService from "@/services/inquiry";

export function ResultDetailView({ auditId }: { auditId: string }) {
  const workHydrated = useAuditWorkHydrated();
  const reviewHydrated = useReviewHydrated();
  const inquiryHydrated = useInquiryHydrated();
  const convHydrated = useConversationHydrated();
  const audits = useAuditWorkStore((s) => s.audits);
  const reviews = useReviewStore((s) => s.reviews);
  const inquiries = useInquiryStore((s) => s.inquiries);
  const allFeedback = useAuditStore((s) => s.feedback);
  const auditorId = useAccountStore((s) => s.auditor.id);
  // 라이브 대화 스냅샷 반영을 위해 conversation 스토어를 구독한다.
  const convRecords = useConversationStore((s) => s.records);

  const audit = useMemo(() => audits.find((a) => a.id === auditId), [audits, auditId]);
  const review = useMemo(
    () => (audit ? reviewForAudit(reviews, audits, audit) : null),
    [reviews, audits, audit],
  );
  // 정적 번들 + 라이브 대화(정지 스냅샷) 양쪽에서 해소.
  const conv = useMemo(
    () => (audit ? getConversation(audit.conversationId) : null),
    // convRecords 를 의존성에 두어 스토어 하이드레이션 시 재계산.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [audit, convRecords],
  );
  const auditFeedback = useMemo(
    () =>
      audit
        ? allFeedback.filter((f) => f.conversationId === audit.conversationId)
        : [],
    [allFeedback, audit],
  );
  const relatedInquiries = useMemo(
    () => inquiries.filter((q) => q.auditId === auditId),
    [inquiries, auditId],
  );

  // 진입 시 review 를 본 적 있다고 마킹 (저장/최종승인 어느 쪽이든 결과가 열린 상태)
  useEffect(() => {
    if (
      review &&
      auditorId &&
      (review.status === "saved" || review.status === "finalized") &&
      !review.seenByAuditors[auditorId]
    ) {
      void reviewService.markSeenByAuditor(review.id, auditorId);
    }
  }, [review, auditorId]);

  if (!workHydrated || !reviewHydrated || !inquiryHydrated || !convHydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>;
  }
  if (!audit || !conv) {
    return (
      <div className="px-6 py-10">
        <h1 className="text-2xl font-bold">완료 항목을 찾을 수 없습니다</h1>
        <Link href="/audit/results" className="mt-2 inline-block text-sm underline">
          ← 완료 목록
        </Link>
      </div>
    );
  }

  const occ = getOccupation(conv.persona.occupation);
  const decisions = new Map<
    string,
    { accepted: boolean; reason?: string; decidedAt: number }
  >();
  for (const d of review?.decisions ?? []) {
    decisions.set(d.feedbackId, {
      accepted: d.accepted,
      reason: d.reason,
      decidedAt: d.decidedAt,
    });
  }
  const accepted = auditFeedback.filter(
    (f) => decisions.get(f.id)?.accepted,
  ).length;
  const rejected = auditFeedback.length - accepted;
  // 이의 가능 구간 = "저장~최종승인" 사이(saved). 최종 승인되면 확정·잠김.
  const isSaved = review?.status === "saved";
  const isFinalized = review?.status === "finalized";
  const resultsOpen = isSaved || isFinalized;
  const disputeOpen = isSaved;

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p title={audit.id} className="font-mono text-xs text-muted-foreground">{middleTruncate(audit.id)}</p>
          <h1 className="text-2xl font-bold tracking-tight">{conv.topic.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant={auditStatusVariant(audit.status)}>
              {AUDIT_STATUS_LABEL[audit.status]}
            </Badge>
            <Badge variant="outline">
              {occ ? `${occ.emoji} ${occ.label}` : conv.persona.label}
            </Badge>
            <span>제출 {formatDate(audit.submittedAt)}</span>
            {review?.finalizedAt && (
              <>
                <span>·</span>
                <span>검수 확정 {formatDate(review.finalizedAt)}</span>
              </>
            )}
          </div>
        </div>
        <Link href="/audit/results" className="text-sm underline">
          ← 목록
        </Link>
      </div>

      {audit.status === "submitted" && (
        <section className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
          관리자가 검수 중입니다. 검수가 완료되면 알림과 함께 결과가 표시됩니다.
        </section>
      )}

      {resultsOpen && (
        <>
          <section
            className={cn(
              "rounded-xl border px-4 py-3 text-sm",
              isSaved
                ? "border-amber-300 bg-amber-50 text-amber-900"
                : "border-emerald-300 bg-emerald-50 text-emerald-900",
            )}
          >
            {isSaved
              ? "관리자가 검수 결과를 저장했습니다. 최종 승인 전까지 거절 결정에 이의를 제기할 수 있습니다."
              : "최종 승인되어 검수 결과가 확정되었습니다. 더 이상 변경되지 않습니다."}
          </section>

          <section className="rounded-xl border bg-card">
            <header className="border-b px-4 py-2 text-sm font-semibold">검수 요약</header>
            <div className="grid grid-cols-3 divide-x text-sm">
              <div className="px-4 py-3">
                <p className="text-xs text-muted-foreground">총 피드백</p>
                <p className="mt-0.5 text-2xl font-semibold tabular-nums">
                  {auditFeedback.length}
                </p>
              </div>
              <div className="px-4 py-3">
                <p className="text-xs text-muted-foreground">인정</p>
                <p className="mt-0.5 text-2xl font-semibold tabular-nums text-emerald-700">
                  {accepted}
                </p>
              </div>
              <div className="px-4 py-3">
                <p className="text-xs text-muted-foreground">거절</p>
                <p className="mt-0.5 text-2xl font-semibold tabular-nums text-rose-700">
                  {rejected}
                </p>
              </div>
            </div>
            {review.overallNote && (
              <div className="border-t px-4 py-2 text-xs">
                <span className="text-muted-foreground">관리자 총평: </span>
                {review.overallNote}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold">문장별 결과</h2>
            <ul className="flex flex-col gap-2">
              {auditFeedback.map((f) => {
                const dec = decisions.get(f.id);
                const segment = conv.messages
                  .flatMap((m) => m.segments)
                  .find((s) => s.id === f.segmentId);
                const inquiry = relatedInquiries.find((q) => q.feedbackId === f.id);
                return (
                  <FeedbackRow
                    key={f.id}
                    feedback={f}
                    decision={dec}
                    segmentText={segment?.text ?? "—"}
                    auditId={audit.id}
                    auditorId={auditorId}
                    reviewerId={review.reviewerId}
                    inquiry={inquiry}
                    disputeOpen={disputeOpen}
                  />
                );
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function FeedbackRow({
  feedback,
  decision,
  segmentText,
  auditId,
  auditorId,
  reviewerId,
  inquiry,
  disputeOpen,
}: {
  feedback: { id: string; body: string; tags: string[] };
  decision?: { accepted: boolean; reason?: string; decidedAt: number };
  segmentText: string;
  auditId: string;
  auditorId: string;
  reviewerId: string;
  inquiry?: { id: string; status: string; messages: { body: string; authorRole: string; createdAt: number; id: string }[] };
  disputeOpen: boolean;
}) {
  const [showForm, setShowForm] = useState(false);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const accepted = decision?.accepted ?? true; // 결정 없으면 기본 인정으로 표시

  const onSubmitInquiry = async () => {
    if (!body.trim()) return;
    setSubmitting(true);
    try {
      await inquiryService.create({
        auditId,
        feedbackId: feedback.id,
        body: body.trim(),
        raisedBy: auditorId,
      });
      setBody("");
      setShowForm(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <li
      className={cn(
        "rounded-lg border bg-card px-4 py-3",
        accepted
          ? "border-l-4 border-l-emerald-400"
          : "border-l-4 border-l-rose-400",
      )}
    >
      <div className="flex items-start gap-3">
        {accepted ? (
          <CheckCircle2 className="mt-1 size-4 shrink-0 text-emerald-600" />
        ) : (
          <XCircle className="mt-1 size-4 shrink-0 text-rose-600" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground italic">"{segmentText}"</p>
          <p className="mt-1.5 text-sm">{feedback.body}</p>
          {feedback.tags && feedback.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {feedback.tags.map((t) => (
                <Badge key={t} variant="secondary" className="text-[10px]">
                  {FEEDBACK_TAG_LABELS[t as keyof typeof FEEDBACK_TAG_LABELS] ?? t}
                </Badge>
              ))}
            </div>
          )}
          {!accepted && decision && (
            <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-900">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-rose-700">
                <span className="font-medium">거절</span>
                <span>·</span>
                <span title={reviewerId} className="font-mono">
                  {middleTruncate(reviewerId)}
                </span>
                <span>·</span>
                <span className="tabular-nums">
                  {formatDateTime(decision.decidedAt)}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap">
                <span className="font-medium">사유: </span>
                {decision.reason?.trim() || "사유가 기재되지 않았습니다."}
              </p>
            </div>
          )}
        </div>
      </div>

      {inquiry && (
        <div className="mt-3 rounded-md border bg-muted/30 p-2 text-xs">
          <div className="flex items-center gap-2">
            <MessageCircle className="size-3" />
            <span className="font-medium">이의제기 ({inquiry.status})</span>
          </div>
          <ul className="mt-1 space-y-1">
            {inquiry.messages.map((m) => (
              <li key={m.id}>
                <span className="font-medium">
                  {m.authorRole === "auditor" ? "나" : "관리자"}:
                </span>{" "}
                <span className="whitespace-pre-wrap">{m.body}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!accepted && disputeOpen && !inquiry && (
        <div className="mt-2">
          {!showForm ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowForm(true)}
            >
              이의제기
            </Button>
          ) : (
            <div className="flex flex-col gap-2 rounded-md border bg-card p-2">
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="이 결정에 대한 이의제기 내용"
                rows={3}
              />
              <div className="flex justify-end gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowForm(false);
                    setBody("");
                  }}
                >
                  취소
                </Button>
                <Button
                  size="sm"
                  onClick={onSubmitInquiry}
                  disabled={!body.trim() || submitting}
                >
                  {submitting ? "전송 중…" : "제출"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
