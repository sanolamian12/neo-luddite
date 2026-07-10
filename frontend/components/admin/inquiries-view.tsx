"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useInquiryHydrated, useInquiryStore } from "@/lib/inquiry-store";
import { useAuditWorkStore } from "@/lib/audit-work-store";
import { useAuditStore } from "@/lib/audit-store";
import { useReviewStore } from "@/lib/review-store";
import { useAccountStore } from "@/lib/account-store";
import { conversations } from "@/lib/load-conversation";
import { formatDateTime } from "@/lib/poc-format";
import { cn, middleTruncate } from "@/lib/utils";
import * as inquiryService from "@/services/inquiry";
import type { InquiryStatus } from "@/lib/poc-schema";

const STATUS_LABEL: Record<InquiryStatus, string> = {
  open: "미답변",
  replied: "답변완료",
  resolved: "종료",
};

export function InquiriesView() {
  const hydrated = useInquiryHydrated();
  const inquiries = useInquiryStore((s) => s.inquiries);
  const audits = useAuditWorkStore((s) => s.audits);
  const feedback = useAuditStore((s) => s.feedback);
  const reviews = useReviewStore((s) => s.reviews);
  const adminId = useAccountStore((s) => s.admin.id);

  const [filter, setFilter] = useState<InquiryStatus | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 모바일(<md)에서는 목록/상세 동시 표시가 안 되므로 전환한다.
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const [reply, setReply] = useState("");
  const [amendCheck, setAmendCheck] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const list = [...inquiries].sort((a, b) => b.raisedAt - a.raisedAt);
    if (filter === "all") return list;
    return list.filter((q) => q.status === filter);
  }, [inquiries, filter]);

  // 첫 항목 자동 선택
  useEffect(() => {
    if (!selectedId && filtered.length > 0) setSelectedId(filtered[0].id);
  }, [filtered, selectedId]);

  // 선택 바뀌면 reply 초기화
  useEffect(() => {
    setReply("");
    setAmendCheck(false);
    setError(null);
  }, [selectedId]);

  if (!hydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>;
  }

  const selected = filtered.find((q) => q.id === selectedId) ?? null;
  const audit = selected ? audits.find((a) => a.id === selected.auditId) : null;
  const feedbackItem = selected?.feedbackId
    ? feedback.find((f) => f.id === selected.feedbackId)
    : null;
  const review = audit ? reviews.find((r) => r.auditId === audit.id) : null;
  const currentDecision = feedbackItem
    ? review?.decisions.find((d) => d.feedbackId === feedbackItem.id)
    : null;

  const onReply = async () => {
    if (!selected || !reply.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await inquiryService.reply({
        inquiryId: selected.id,
        body: reply.trim(),
        authorId: adminId,
        amend:
          amendCheck && feedbackItem
            ? {
                feedbackId: feedbackItem.id,
                accepted: true,
                reason: undefined,
              }
            : undefined,
      });
      setReply("");
      setAmendCheck(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const onResolve = async () => {
    if (!selected) return;
    await inquiryService.resolve(selected.id);
  };

  return (
    <div className="flex flex-1 min-h-0">
      <aside
        className={cn(
          "w-full shrink-0 flex-col border-r md:flex md:w-[320px]",
          mobileView === "detail" ? "hidden md:flex" : "flex",
        )}
      >
        <div className="border-b px-3 py-2">
          <h1 className="text-sm font-semibold">이의제기</h1>
          <div className="mt-2 flex flex-wrap gap-1">
            {(["all", "open", "replied", "resolved"] as const).map((s) => (
              <Button
                key={s}
                size="xs"
                variant={filter === s ? "default" : "outline"}
                onClick={() => setFilter(s)}
              >
                {s === "all" ? "전체" : STATUS_LABEL[s]}
              </Button>
            ))}
          </div>
        </div>
        <ul className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-sm text-muted-foreground">없습니다.</li>
          ) : (
            filtered.map((q) => {
              const a = audits.find((x) => x.id === q.auditId);
              return (
                <li key={q.id}>
                  <button
                    onClick={() => {
                      setSelectedId(q.id);
                      setMobileView("detail");
                    }}
                    className={cn(
                      "w-full px-3 py-2 text-left text-sm transition border-b",
                      selectedId === q.id ? "bg-muted" : "hover:bg-muted/50",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs truncate" title={q.id}>
                        {middleTruncate(q.id)}
                      </span>
                      <Badge variant={q.status === "open" ? "default" : "secondary"} className="text-[10px]">
                        {STATUS_LABEL[q.status]}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground truncate">
                      {middleTruncate(a?.id ?? q.auditId)} · {q.raisedBy}
                    </p>
                    <p className="mt-1 text-xs line-clamp-2">{q.messages[0].body}</p>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </aside>

      <main
        className={cn(
          "flex-1 overflow-y-auto md:block",
          mobileView === "list" ? "hidden" : "block",
        )}
      >
        {/* 모바일 전용 뒤로가기 */}
        <button
          type="button"
          onClick={() => setMobileView("list")}
          className="flex w-full items-center gap-1 border-b px-4 py-2 text-sm text-muted-foreground md:hidden"
        >
          ← 이의제기 목록
        </button>
        {!selected ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            왼쪽에서 이의제기를 선택하세요.
          </div>
        ) : (
          <div className="flex flex-col gap-6 px-4 py-6 md:px-6 max-w-3xl">
            <header>
              <p className="font-mono text-xs text-muted-foreground" title={selected.id}>
                {middleTruncate(selected.id)}
              </p>
              <h1 className="text-2xl font-bold tracking-tight">이의제기 상세</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <Badge variant={selected.status === "open" ? "default" : "secondary"}>
                  {STATUS_LABEL[selected.status]}
                </Badge>
                <span>제기 {formatDateTime(selected.raisedAt)}</span>
                <span>·</span>
                <span>제기자 {selected.raisedBy}</span>
              </div>
            </header>

            {audit && (
              <section className="rounded-xl border bg-card px-4 py-3">
                <h2 className="text-sm font-semibold">원본 결과물</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Audit:{" "}
                  <Link
                    href={`/admin/inspection/${audit.id}`}
                    className="font-mono underline"
                    title={audit.id}
                  >
                    {middleTruncate(audit.id)}
                  </Link>{" "}
                  · {conversations[audit.conversationId]?.topic.title}
                </p>
                {feedbackItem && (
                  <div className="mt-2 rounded-md bg-muted px-2 py-1.5">
                    <p className="text-xs text-muted-foreground">평가자 피드백</p>
                    <p className="text-sm">{feedbackItem.body}</p>
                  </div>
                )}
                {currentDecision && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    현 결정: {currentDecision.accepted ? "인정" : "거절"}
                    {currentDecision.reason ? ` (${currentDecision.reason})` : ""}
                  </p>
                )}
              </section>
            )}

            <section className="rounded-xl border bg-card">
              <header className="border-b px-4 py-2 text-sm font-semibold">대화</header>
              <ul className="divide-y">
                {selected.messages.map((m) => (
                  <li key={m.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium">
                        {m.authorRole === "auditor" ? "평가자" : "관리자"}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {formatDateTime(m.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{m.body}</p>
                  </li>
                ))}
              </ul>
            </section>

            {selected.status !== "resolved" && (
              <section className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold">답변 작성</h2>
                <Textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  rows={4}
                  placeholder="이의제기에 대한 답변"
                />
                {feedbackItem &&
                  currentDecision &&
                  !currentDecision.accepted &&
                  review?.status === "saved" && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={amendCheck}
                        onChange={(e) => setAmendCheck(e.target.checked)}
                      />
                      이 결정을 <b>인정</b>으로 변경 (최종 승인 시 반영)
                    </label>
                  )}
                {review?.status === "finalized" && (
                  <p className="text-xs text-muted-foreground">
                    최종 승인되어 결정은 변경할 수 없습니다(답변만 가능).
                  </p>
                )}
                {error && (
                  <p className="text-sm text-destructive">{error}</p>
                )}
                <div className="flex items-center justify-end gap-2">
                  <Button variant="ghost" onClick={onResolve}>
                    종료 처리
                  </Button>
                  <Button
                    onClick={onReply}
                    disabled={!reply.trim() || submitting}
                  >
                    {submitting ? "전송 중…" : "답변 발송"}
                  </Button>
                </div>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
