"use client";

import { useConversationStore, useConversationHydrated } from "./conversation-store";
import { useAuditTaskStore, useAuditTaskHydrated } from "./audit-task-store";
import { useAuditWorkStore, useAuditWorkHydrated } from "./audit-work-store";
import { useInquiryStore, useInquiryHydrated } from "./inquiry-store";
import { useReviewStore, useReviewHydrated } from "./review-store";
import { useMailStore, useMailHydrated } from "./mail-store";
import { useAccountStore } from "./account-store";
import { countUnseenResults } from "./review-lookup";

/**
 * 사이드바 메뉴 항목 옆 배지 카운트 계산 — admin / auditor 셸 양쪽이 사용.
 *
 * Hydration 이 완료되지 않았을 때는 `undefined` 를 반환한다 → 사이드바는 배지를 숨김.
 */
export interface AdminSidebarBadges {
  poolNew?: number;
  inspectionCount?: number;
  inquiriesOpen?: number;
}

export interface AuditorSidebarBadges {
  queueOpen?: number;
  workInProgress?: number;
  resultsUnseen?: number;
  mailboxUnread?: number;
}

export function useAdminSidebarBadges(): AdminSidebarBadges {
  const convHydrated = useConversationHydrated();
  const taskHydrated = useAuditTaskHydrated();
  const workHydrated = useAuditWorkHydrated();
  const inqHydrated = useInquiryHydrated();
  const records = useConversationStore((s) => s.records);
  const audits = useAuditWorkStore((s) => s.audits);
  const inquiries = useInquiryStore((s) => s.inquiries);
  const tasks = useAuditTaskStore((s) => s.tasks);

  if (!convHydrated || !taskHydrated || !workHydrated || !inqHydrated)
    return {};

  // 신규 = 사진 찍힘 & 미제외 & 아직 어떤 Task 에도 미배정.
  const assignedIds = new Set<string>();
  for (const t of tasks) for (const cid of t.conversationIds) assignedIds.add(cid);
  const poolNew = records.filter(
    (c) => c.snapshotAt != null && c.excludedAt == null && !assignedIds.has(c.id),
  ).length;
  const inspectionCount = audits.filter((a) => a.status === "submitted").length;
  const inquiriesOpen = inquiries.filter((q) => q.status === "open").length;
  return {
    poolNew: poolNew > 0 ? poolNew : undefined,
    inspectionCount: inspectionCount > 0 ? inspectionCount : undefined,
    inquiriesOpen: inquiriesOpen > 0 ? inquiriesOpen : undefined,
  };
}

export function useAuditorSidebarBadges(): AuditorSidebarBadges {
  const taskHydrated = useAuditTaskHydrated();
  const workHydrated = useAuditWorkHydrated();
  const reviewHydrated = useReviewHydrated();
  const mailHydrated = useMailHydrated();
  const tasks = useAuditTaskStore((s) => s.tasks);
  const audits = useAuditWorkStore((s) => s.audits);
  const reviews = useReviewStore((s) => s.reviews);
  const mails = useMailStore((s) => s.mails);
  const auditorId = useAccountStore((s) => s.auditor.id);

  if (!taskHydrated || !workHydrated || !reviewHydrated || !mailHydrated)
    return {};

  const queueOpen = tasks.filter((t) => {
    if (t.status !== "open" && t.status !== "in_progress") return false;
    if (t.pickups.some((p) => p.auditorId === auditorId)) return false;
    return t.pickups.length < t.capacity;
  }).length;

  const myAudits = audits.filter((a) => a.auditorId === auditorId);
  const workInProgress = myAudits.filter((a) => a.status === "draft").length;
  // 결과가 열린(저장·최종승인) audit 중 평가자가 본 적 없는 것
  const resultsUnseen = countUnseenResults(reviews, audits, auditorId);
  const mailboxUnread = mails.filter(
    (m) => m.recipientId === auditorId && !m.readAt,
  ).length;

  return {
    queueOpen: queueOpen > 0 ? queueOpen : undefined,
    workInProgress: workInProgress > 0 ? workInProgress : undefined,
    resultsUnseen: resultsUnseen > 0 ? resultsUnseen : undefined,
    mailboxUnread: mailboxUnread > 0 ? mailboxUnread : undefined,
  };
}
