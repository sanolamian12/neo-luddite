"use client";

import { usePoolStore, usePoolHydrated } from "./pool-store";
import { useAuditTaskStore, useAuditTaskHydrated } from "./audit-task-store";
import { useAuditWorkStore, useAuditWorkHydrated } from "./audit-work-store";
import { useInquiryStore, useInquiryHydrated } from "./inquiry-store";
import { useReviewStore, useReviewHydrated } from "./review-store";
import { useMailStore, useMailHydrated } from "./mail-store";
import { useAccountStore } from "./account-store";

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
  const poolHydrated = usePoolHydrated();
  const taskHydrated = useAuditTaskHydrated();
  const workHydrated = useAuditWorkHydrated();
  const inqHydrated = useInquiryHydrated();
  const pool = usePoolStore((s) => s.candidates);
  const audits = useAuditWorkStore((s) => s.audits);
  const inquiries = useInquiryStore((s) => s.inquiries);
  void useAuditTaskStore((s) => s.tasks); // 의존성 유지

  if (!poolHydrated || !taskHydrated || !workHydrated || !inqHydrated)
    return {};

  const poolNew = pool.filter((c) => c.status === "new").length;
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
  // 검수 완료된 audit 중 평가자가 본 적 없는 것
  const myAuditIds = new Set(myAudits.map((a) => a.id));
  const resultsUnseen = reviews.filter(
    (r) =>
      r.status === "finalized" &&
      !r.seenByAuditorAt &&
      myAuditIds.has(r.auditId),
  ).length;
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
