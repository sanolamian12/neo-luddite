"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMailHydrated, useMailStore } from "@/lib/mail-store";
import { useInquiryStore } from "@/lib/inquiry-store";
import { useSettlementStore } from "@/lib/settlement-store";
import { useAccountStore } from "@/lib/account-store";
import { formatDateTime } from "@/lib/poc-format";
import { cn } from "@/lib/utils";
import * as mailService from "@/services/mail";
import type { Mail, MailKind } from "@/lib/poc-schema";

const KIND_LABEL: Record<MailKind, string> = {
  notice: "공지",
  inquiry_reply: "이의 답변",
  settlement: "정산 안내",
};

const KIND_VARIANT: Record<MailKind, "default" | "secondary" | "outline"> = {
  notice: "secondary",
  inquiry_reply: "default",
  settlement: "outline",
};

export function MailboxView() {
  const hydrated = useMailHydrated();
  const mails = useMailStore((s) => s.mails);
  const inquiries = useInquiryStore((s) => s.inquiries);
  const rounds = useSettlementStore((s) => s.rounds);
  const auditorId = useAccountStore((s) => s.auditor.id);

  const [filter, setFilter] = useState<MailKind | "all" | "unread">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const myMails = useMemo(
    () =>
      mails
        .filter((m) => m.recipientId === auditorId)
        .sort((a, b) => b.sentAt - a.sentAt),
    [mails, auditorId],
  );

  const filtered = useMemo(() => {
    if (filter === "all") return myMails;
    if (filter === "unread") return myMails.filter((m) => !m.readAt);
    return myMails.filter((m) => m.kind === filter);
  }, [myMails, filter]);

  useEffect(() => {
    if (!selectedId && filtered.length > 0) setSelectedId(filtered[0].id);
  }, [filtered, selectedId]);

  // 진입 시 자동 markRead
  useEffect(() => {
    if (!selectedId) return;
    const m = myMails.find((x) => x.id === selectedId);
    if (m && !m.readAt) void mailService.markRead(selectedId);
  }, [selectedId, myMails]);

  if (!hydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>;
  }

  const selected = filtered.find((m) => m.id === selectedId) ?? null;

  return (
    <div className="flex flex-1 min-h-0">
      <aside className="w-[320px] shrink-0 border-r flex flex-col">
        <div className="border-b px-3 py-2">
          <h1 className="text-sm font-semibold">우편함</h1>
          <div className="mt-2 flex flex-wrap gap-1">
            {(["all", "unread", "notice", "inquiry_reply", "settlement"] as const).map((s) => (
              <Button
                key={s}
                size="xs"
                variant={filter === s ? "default" : "outline"}
                onClick={() => setFilter(s)}
              >
                {s === "all" ? "전체" : s === "unread" ? "미확인" : KIND_LABEL[s as MailKind]}
              </Button>
            ))}
          </div>
        </div>
        <ul className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-sm text-muted-foreground">없습니다.</li>
          ) : (
            filtered.map((m) => (
              <li key={m.id}>
                <button
                  onClick={() => setSelectedId(m.id)}
                  className={cn(
                    "w-full px-3 py-2 text-left text-sm transition border-b",
                    selectedId === m.id ? "bg-muted" : "hover:bg-muted/50",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={KIND_VARIANT[m.kind]} className="text-[10px]">
                      {KIND_LABEL[m.kind]}
                    </Badge>
                    {!m.readAt && (
                      <span className="size-1.5 rounded-full bg-primary" aria-label="미확인" />
                    )}
                  </div>
                  <p className={cn("mt-1 truncate font-medium", !m.readAt && "font-semibold")}>
                    {m.subject}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {formatDateTime(m.sentAt)}
                  </p>
                </button>
              </li>
            ))
          )}
        </ul>
      </aside>

      <main className="flex-1 overflow-y-auto">
        {!selected ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            왼쪽에서 우편을 선택하세요.
          </div>
        ) : (
          <MailDetail mail={selected} inquiries={inquiries} rounds={rounds} />
        )}
      </main>
    </div>
  );
}

function MailDetail({
  mail,
  inquiries,
  rounds,
}: {
  mail: Mail;
  inquiries: ReturnType<typeof useInquiryStore.getState>["inquiries"];
  rounds: ReturnType<typeof useSettlementStore.getState>["rounds"];
}) {
  const ref = mail.ref;
  const linkedInquiry =
    ref && ref.kind === "inquiry"
      ? inquiries.find((q) => q.id === ref.inquiryId)
      : null;
  const linkedRound =
    ref && ref.kind === "settlement"
      ? rounds.find((r) => r.id === ref.roundId)
      : null;
  const myAlloc =
    linkedRound?.allocations.find((a) => a.auditorId === mail.recipientId);

  return (
    <div className="flex flex-col gap-6 px-6 py-6 max-w-3xl">
      <header>
        <Badge variant="secondary">{KIND_LABEL[mail.kind]}</Badge>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">{mail.subject}</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          발신 {mail.senderId} · {formatDateTime(mail.sentAt)}
        </p>
      </header>

      <section className="rounded-xl border bg-card px-4 py-3">
        <p className="whitespace-pre-wrap text-sm">{mail.body || "(내용 없음)"}</p>
      </section>

      {linkedInquiry && (
        <section className="rounded-xl border bg-card px-4 py-3">
          <h2 className="text-sm font-semibold">관련 이의제기</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            상태: {linkedInquiry.status} · 메시지 {linkedInquiry.messages.length}
          </p>
          <ul className="mt-2 space-y-2 text-sm">
            {linkedInquiry.messages.slice(-3).map((m) => (
              <li key={m.id} className="rounded-md bg-muted px-2 py-1.5">
                <p className="text-[10px] uppercase text-muted-foreground">
                  {m.authorRole === "auditor" ? "나" : "관리자"}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap">{m.body}</p>
              </li>
            ))}
          </ul>
          {mail.ref?.kind === "inquiry" && (
            <p className="mt-2 text-xs">
              <Link
                href={`/audit/results/${linkedInquiry.auditId}`}
                className="underline"
              >
                원본 결과물 보기 →
              </Link>
            </p>
          )}
        </section>
      )}

      {linkedRound && myAlloc && (
        <section className="rounded-xl border bg-card">
          <header className="flex items-center justify-between gap-2 border-b px-4 py-2">
            <span className="text-sm font-semibold">정산 내역</span>
            {myAlloc.paidAt != null ? (
              <div className="flex items-center gap-1.5">
                <Badge variant="default" className="text-[10px]">입금 완료</Badge>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {formatDateTime(myAlloc.paidAt)}
                </span>
              </div>
            ) : (
              <Badge variant="outline" className="text-[10px]">입금 대기</Badge>
            )}
          </header>
          <div className="grid grid-cols-3 divide-x text-sm">
            <div className="px-4 py-3">
              <p className="text-xs text-muted-foreground">회차</p>
              <p className="mt-0.5 font-semibold">{linkedRound.label}</p>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs text-muted-foreground">분배</p>
              <p className="mt-0.5 font-semibold text-emerald-700 tabular-nums">
                +{myAlloc.amount} cr
              </p>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs text-muted-foreground">인정 피드백</p>
              <p className="mt-0.5 font-semibold tabular-nums">
                {myAlloc.acceptedCount}건
              </p>
            </div>
          </div>
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">
            분배 모델: {linkedRound.distributionModel} · 포함 audit{" "}
            {myAlloc.includedAuditIds.length}건 ·{" "}
            <Link href="/audit/ledger" className="underline">
              모델 기여 로그에서 보기 →
            </Link>
          </p>
        </section>
      )}
    </div>
  );
}
