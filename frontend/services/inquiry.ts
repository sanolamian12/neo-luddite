"use client";

import { getSupabase } from "@/lib/supabase/client";
import { useInquiryStore, rowToInquiry, type InquiryRow } from "@/lib/inquiry-store";
import { useAuditWorkStore } from "@/lib/audit-work-store";
import type { Inquiry, InquiryMessage } from "@/lib/poc-schema";
import * as mailService from "./mail";
import * as reviewService from "./review";

/**
 * Inquiry service — auditor 가 review 결과에 이의제기, admin 이 답변.
 *
 * 쓰기: Supabase `inquiries` 에 반영 + 낙관적 스토어 갱신(Realtime echo 는 멱등).
 * 읽기: Realtime 동기화된 스토어 캐시에서 필터/정렬 (형태·로직 불변, §3-3).
 */

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

export interface CreateInquiryInput {
  auditId: string;
  feedbackId?: string;
  body: string;
  raisedBy: string; // auditorId
}

export async function create(input: CreateInquiryInput): Promise<Inquiry> {
  const sb = getSupabase();
  const msg: InquiryMessage = {
    id: makeId("msg"),
    authorId: input.raisedBy,
    authorRole: "auditor",
    body: input.body,
    createdAt: Date.now(),
  };
  const inquiry: Inquiry = {
    id: makeId("inq"),
    auditId: input.auditId,
    feedbackId: input.feedbackId,
    raisedBy: input.raisedBy,
    raisedAt: Date.now(),
    messages: [msg],
    status: "open",
    amendedFeedbackIds: [],
  };
  const { error } = await sb.from("inquiries").insert({
    id: inquiry.id,
    audit_id: inquiry.auditId,
    feedback_id: inquiry.feedbackId ?? null,
    raised_by: inquiry.raisedBy,
    raised_at: inquiry.raisedAt,
    messages: [msg],
    status: inquiry.status,
    amended_feedback_ids: [],
  });
  if (error) throw error;
  useInquiryStore.getState()._upsert(inquiry);
  return inquiry;
}

export interface InquiryFilter {
  status?: "open" | "replied" | "resolved";
  auditId?: string;
  raisedBy?: string;
}

export async function listAll(
  filter?: InquiryFilter,
): Promise<{ items: Inquiry[]; total: number }> {
  let items = useInquiryStore.getState().inquiries.slice();
  if (filter?.status) items = items.filter((i) => i.status === filter.status);
  if (filter?.auditId) items = items.filter((i) => i.auditId === filter.auditId);
  if (filter?.raisedBy)
    items = items.filter((i) => i.raisedBy === filter.raisedBy);
  items.sort((a, b) => b.raisedAt - a.raisedAt);
  return { items, total: items.length };
}

export async function get(id: string): Promise<Inquiry | null> {
  return useInquiryStore.getState().inquiries.find((i) => i.id === id) ?? null;
}

/** inquiryId 의 최신 상태를 DB 에서 직접 읽는다(read-modify-write 경합 방지). */
async function fetchInquiry(inquiryId: string): Promise<Inquiry | null> {
  const { data, error } = await getSupabase()
    .from("inquiries")
    .select("*")
    .eq("id", inquiryId)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToInquiry(data as InquiryRow) : null;
}

/** admin 이 답변. 답변 시 mail 자동 발송. */
export async function reply(input: {
  inquiryId: string;
  body: string;
  authorId: string; // adminId
  amend?: { feedbackId: string; accepted: boolean; reason?: string };
}): Promise<Inquiry | null> {
  const sb = getSupabase();
  const inquiry = await fetchInquiry(input.inquiryId);
  if (!inquiry) return null;
  const msg: InquiryMessage = {
    id: makeId("msg"),
    authorId: input.authorId,
    authorRole: "admin",
    body: input.body,
    createdAt: Date.now(),
  };
  const newMessages = [...inquiry.messages, msg];
  const { error } = await sb
    .from("inquiries")
    .update({ messages: newMessages, status: "replied" })
    .eq("id", input.inquiryId);
  if (error) throw error;
  useInquiryStore.getState()._appendMessage(input.inquiryId, msg);
  useInquiryStore.getState()._patch(input.inquiryId, { status: "replied" });

  // 결정 변경이 있는 경우 review 보정
  if (input.amend) {
    const audit = useAuditWorkStore
      .getState()
      .audits.find((a) => a.id === inquiry.auditId);
    if (audit) {
      const review = await reviewService.getForAudit(audit.id);
      if (review) {
        await reviewService.amendDecision(review.id, input.amend.feedbackId, {
          accepted: input.amend.accepted,
          reason: input.amend.reason,
        });
        const mergedAmended = Array.from(
          new Set([...(inquiry.amendedFeedbackIds ?? []), input.amend.feedbackId]),
        );
        const { error: amendErr } = await sb
          .from("inquiries")
          .update({ amended_feedback_ids: mergedAmended })
          .eq("id", input.inquiryId);
        if (amendErr) throw amendErr;
        useInquiryStore.getState()._patch(input.inquiryId, {
          amendedFeedbackIds: mergedAmended,
        });
      }
    }
  }

  // 자동 mail 발송
  const audit = useAuditWorkStore
    .getState()
    .audits.find((a) => a.id === inquiry.auditId);
  if (audit) {
    await mailService.send({
      recipientId: inquiry.raisedBy,
      senderId: input.authorId,
      kind: "inquiry_reply",
      subject: `${audit.id} 이의제기 답변`,
      body: input.body,
      ref: { kind: "inquiry", inquiryId: inquiry.id },
    });
  }

  return get(input.inquiryId);
}

export async function resolve(inquiryId: string): Promise<Inquiry | null> {
  const sb = getSupabase();
  const { error } = await sb
    .from("inquiries")
    .update({ status: "resolved" })
    .eq("id", inquiryId);
  if (error) throw error;
  useInquiryStore.getState()._patch(inquiryId, { status: "resolved" });
  return get(inquiryId);
}

export interface InquirySummary {
  open: number;
}
export async function summary(): Promise<InquirySummary> {
  const items = useInquiryStore.getState().inquiries;
  return { open: items.filter((i) => i.status === "open").length };
}
