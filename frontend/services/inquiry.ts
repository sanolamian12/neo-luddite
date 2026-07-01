"use client";

import { useInquiryStore } from "@/lib/inquiry-store";
import { useAuditWorkStore } from "@/lib/audit-work-store";
import type { Inquiry, InquiryMessage } from "@/lib/poc-schema";
import * as mailService from "./mail";
import * as reviewService from "./review";

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

/** admin 이 답변. 답변 시 mail 자동 발송. */
export async function reply(input: {
  inquiryId: string;
  body: string;
  authorId: string; // adminId
  amend?: { feedbackId: string; accepted: boolean; reason?: string };
}): Promise<Inquiry | null> {
  const inquiry = await get(input.inquiryId);
  if (!inquiry) return null;
  const msg: InquiryMessage = {
    id: makeId("msg"),
    authorId: input.authorId,
    authorRole: "admin",
    body: input.body,
    createdAt: Date.now(),
  };
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
        useInquiryStore.getState()._patch(input.inquiryId, {
          amendedFeedbackIds: Array.from(
            new Set([...(inquiry.amendedFeedbackIds ?? []), input.amend.feedbackId]),
          ),
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
