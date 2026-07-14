"use client";

import { useEffect, useMemo, useState } from "react";
import { Lock, Trash2 } from "lucide-react";
import type { Conversation } from "@/lib/conversation-schema";
import {
  FEEDBACK_TAGS,
  FEEDBACK_TAG_LABELS,
  feedbackDedupeKey,
  type FeedbackTag,
} from "@/lib/audit-schema";
import { feedbackForSegment, useAuditStore } from "@/lib/audit-store";
import { useAuditWorkHydrated, useAuditWorkStore } from "@/lib/audit-work-store";
import { useReviewHydrated, useReviewStore } from "@/lib/review-store";
import { isConversationFinalized } from "@/lib/review-lookup";
import { useAccountStore } from "@/lib/account-store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { KbPicker } from "./kb/kb-picker";
import { KbReferenceChips } from "./kb/kb-reference-chips";

/** 선택한 문장에 대한 라인 피드백 — 기존 목록 + 작성기. */
export function LineFeedbackPanel({
  conversationId,
  conversation,
}: {
  conversationId: string;
  conversation: Conversation;
}) {
  const selectedSegmentId = useAuditStore((s) => s.selectedSegmentId);
  const feedback = useAuditStore((s) => s.feedback);
  const addFeedback = useAuditStore((s) => s.addFeedback);
  const deleteFeedback = useAuditStore((s) => s.deleteFeedback);
  const reviewerName = useAccountStore((s) => s.auditor.reviewerName);
  const auditorId = useAccountStore((s) => s.auditor.id);

  // 검수 확정 잠금 — 확정 뒤 들어온 코멘트는 관리자가 인정/거절할 수 없다.
  const reviews = useReviewStore((s) => s.reviews);
  const audits = useAuditWorkStore((s) => s.audits);
  const reviewHydrated = useReviewHydrated();
  const workHydrated = useAuditWorkHydrated();
  const locked = useMemo(
    () => isConversationFinalized(reviews, audits, conversationId),
    [reviews, audits, conversationId],
  );
  // 두 스토어가 차기 전엔 잠금 여부를 알 수 없다 → 그동안은 저장을 열어두지 않는다.
  const lockKnown = reviewHydrated && workHydrated;

  const [body, setBody] = useState("");
  const [tags, setTags] = useState<FeedbackTag[]>([]);
  const [relatedKbIds, setRelatedKbIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 선택 문장이 바뀌면 작성기 초기화
  useEffect(() => {
    setBody("");
    setTags([]);
    setRelatedKbIds([]);
    setError(null);
  }, [selectedSegmentId]);

  if (!selectedSegmentId) {
    return (
      <p className="text-sm text-muted-foreground">
        왼쪽에서 문장을 선택해 피드백을 작성하세요.
      </p>
    );
  }

  const segment = conversation.messages
    .flatMap((m) => m.segments)
    .find((s) => s.id === selectedSegmentId);
  const items = feedbackForSegment(feedback, conversationId, selectedSegmentId);

  const toggleTag = (t: FeedbackTag) =>
    setTags((cur) =>
      cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t],
    );

  // 작성 중인 내용이 이 문장의 기존 코멘트(작성자 불문)와 같은 문자열인지 — 실시간 판정.
  const draftKey = feedbackDedupeKey(body);
  const duplicateOf = draftKey
    ? items.find((f) => feedbackDedupeKey(f.body) === draftKey)
    : undefined;

  const missingTag = tags.length === 0;
  const canSave =
    !locked &&
    lockKnown &&
    Boolean(body.trim()) &&
    !missingTag &&
    !duplicateOf &&
    !saving;

  const onSave = async () => {
    if (!canSave) return;
    setError(null);
    setSaving(true);
    const failure = await addFeedback({
      conversationId,
      segmentId: selectedSegmentId,
      body: body.trim(),
      tags,
      reviewer: reviewerName,
      auditorId,
      relatedKbIds,
    });
    setSaving(false);
    if (failure) {
      setError(failure);
      return;
    }
    setBody("");
    setTags([]);
    setRelatedKbIds([]);
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold">선택한 문장</h2>
        <p className="mt-1 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
          {segment?.text ?? "—"}
        </p>
      </div>

      {locked && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <Lock className="mt-0.5 size-3.5 shrink-0" />
          <p>
            검수가 확정된 대화입니다. 코멘트를 추가·삭제할 수 없습니다 — 확정
            이후의 코멘트는 관리자가 인정·거절할 수 없기 때문입니다.
          </p>
        </div>
      )}

      {items.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">
            작성된 피드백 ({items.length})
          </h3>
          {items.map((f) => (
            <div key={f.id} className="rounded-lg border p-2 text-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="whitespace-pre-wrap">{f.body}</p>
                {!locked && (
                  <Button
                    variant="destructive"
                    size="icon-xs"
                    onClick={() => deleteFeedback(f.id)}
                    aria-label="피드백 삭제"
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
              {f.tags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {f.tags.map((t) => (
                    <Badge key={t} variant="secondary" className="text-[10px]">
                      {FEEDBACK_TAG_LABELS[t]}
                    </Badge>
                  ))}
                </div>
              )}
              <KbReferenceChips ids={f.relatedKbIds ?? []} />
              <p className="mt-1 text-[10px] text-muted-foreground">
                {f.reviewer}
              </p>
            </div>
          ))}
        </div>
      )}

      {!locked && (
        <div className="flex flex-col gap-2">
          <Textarea
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setError(null);
            }}
            placeholder="이 문장에 대한 피드백을 입력하세요…"
            rows={3}
          />

          <div>
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              분류 (필수 · 중복 선택 가능)
            </span>
            <div className="flex flex-wrap gap-1.5">
              {FEEDBACK_TAGS.map((t) => (
                <Button
                  key={t}
                  type="button"
                  size="sm"
                  variant={tags.includes(t) ? "default" : "outline"}
                  onClick={() => toggleTag(t)}
                >
                  {FEEDBACK_TAG_LABELS[t]}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              관련 KB 문서
            </span>
            <KbPicker selectedIds={relatedKbIds} onChange={setRelatedKbIds} />
          </div>

          {/* 저장 불가 사유를 버튼 위에 미리 알려 준다(눌러 보고 알게 하지 않는다). */}
          {duplicateOf ? (
            <p className="text-xs text-destructive">
              이 문장에 동일한 코멘트가 이미 있습니다
              {duplicateOf.auditorId === auditorId
                ? ""
                : ` (${duplicateOf.reviewer} 님 작성)`}
              . 다른 내용을 남겨 주세요.
            </p>
          ) : (
            missingTag &&
            body.trim() && (
              <p className="text-xs text-muted-foreground">
                분류를 최소 1개 선택해야 저장할 수 있습니다.
              </p>
            )
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <Button onClick={onSave} disabled={!canSave}>
            {saving ? "저장 중…" : "피드백 저장"}
          </Button>
        </div>
      )}
    </div>
  );
}
