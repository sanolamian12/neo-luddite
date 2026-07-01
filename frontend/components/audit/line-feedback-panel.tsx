"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import type { Conversation } from "@/lib/conversation-schema";
import {
  FEEDBACK_TAGS,
  FEEDBACK_TAG_LABELS,
  type FeedbackTag,
} from "@/lib/audit-schema";
import { feedbackForSegment, useAuditStore } from "@/lib/audit-store";
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

  const [body, setBody] = useState("");
  const [tags, setTags] = useState<FeedbackTag[]>([]);
  const [relatedKbIds, setRelatedKbIds] = useState<string[]>([]);

  // 선택 문장이 바뀌면 작성기 초기화
  useEffect(() => {
    setBody("");
    setTags([]);
    setRelatedKbIds([]);
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

  const onSave = () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    addFeedback({
      conversationId,
      segmentId: selectedSegmentId,
      body: trimmed,
      tags,
      reviewer: reviewerName,
      relatedKbIds,
    });
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

      {items.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">
            작성된 피드백 ({items.length})
          </h3>
          {items.map((f) => (
            <div key={f.id} className="rounded-lg border p-2 text-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="whitespace-pre-wrap">{f.body}</p>
                <Button
                  variant="destructive"
                  size="icon-xs"
                  onClick={() => deleteFeedback(f.id)}
                  aria-label="피드백 삭제"
                >
                  <Trash2 />
                </Button>
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

      <div className="flex flex-col gap-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="이 문장에 대한 피드백을 입력하세요…"
          rows={3}
        />
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
        <div>
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            관련 KB 문서
          </span>
          <KbPicker
            selectedIds={relatedKbIds}
            onChange={setRelatedKbIds}
          />
        </div>
        <Button onClick={onSave} disabled={!body.trim()}>
          피드백 저장
        </Button>
      </div>
    </div>
  );
}
