"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ListChecks, MailPlus, ShieldOff, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  useAuditorRegistryHydrated,
  useAuditorRegistryStore,
} from "@/lib/auditor-registry-store";
import { useAuditWorkHydrated, useAuditWorkStore } from "@/lib/audit-work-store";
import { useLedgerHydrated, useLedgerStore } from "@/lib/ledger-store";
import { useReviewStore } from "@/lib/review-store";
import { conversations } from "@/lib/load-conversation";
import {
  AUDIT_STATUS_LABEL,
  auditStatusVariant,
  formatDate,
  formatDateTime,
} from "@/lib/poc-format";
import { cn, middleTruncate } from "@/lib/utils";
import * as auditorService from "@/services/auditor";

const LEDGER_KIND_LABEL: Record<string, string> = {
  contribution_accepted: "기여 인정",
  contribution_rejected: "기여 거절",
  settlement_round: "회차 정산",
  bonus: "보너스",
  adjustment: "보정",
};

export function AuditorDetailView({ auditorId }: { auditorId: string }) {
  const regHydrated = useAuditorRegistryHydrated();
  const workHydrated = useAuditWorkHydrated();
  const ledgerHydrated = useLedgerHydrated();
  const auditors = useAuditorRegistryStore((s) => s.auditors);
  const audits = useAuditWorkStore((s) => s.audits);
  const ledger = useLedgerStore((s) => s.entries);
  const reviews = useReviewStore((s) => s.reviews);

  const auditor = useMemo(
    () => auditors.find((a) => a.id === auditorId) ?? null,
    [auditors, auditorId],
  );
  const myAudits = useMemo(
    () =>
      audits
        .filter((a) => a.auditorId === auditorId)
        .slice()
        .sort((a, b) => (b.submittedAt ?? b.pickedAt) - (a.submittedAt ?? a.pickedAt)),
    [audits, auditorId],
  );
  const myLedger = useMemo(
    () =>
      ledger
        .filter((e) => e.auditorId === auditorId)
        .slice()
        .sort((a, b) => b.timestamp - a.timestamp),
    [ledger, auditorId],
  );

  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setNote(auditor?.note ?? "");
  }, [auditor?.note]);

  if (!regHydrated || !workHydrated || !ledgerHydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>;
  }
  if (!auditor) {
    return (
      <div className="px-6 py-10">
        <h1 className="text-2xl font-bold">평가자를 찾을 수 없습니다</h1>
        <Link href="/admin/auditors" className="mt-2 inline-block text-sm underline">
          ← 목록
        </Link>
      </div>
    );
  }

  // 통계 (stats service 와 동일 로직)
  let accepted = 0;
  let rejected = 0;
  const seen = new Set<string>();
  for (const e of myLedger) {
    if (e.sourceRef.kind === "audit" && !seen.has(e.sourceRef.auditId)) {
      seen.add(e.sourceRef.auditId);
      accepted += e.sourceRef.acceptedCount;
      rejected += e.sourceRef.rejectedCount;
    }
  }
  const acceptanceRate = accepted + rejected === 0 ? null : accepted / (accepted + rejected);
  const totalCredit = myLedger[0]?.balanceAfter ?? 0;

  const settlementCount = myLedger.filter((e) => e.kind === "settlement_round")
    .length;

  const onToggleStatus = async () => {
    setBusy("status");
    try {
      if (auditor.status === "active") await auditorService.suspend(auditor.id);
      else await auditorService.resume(auditor.id);
    } finally {
      setBusy(null);
    }
  };

  const onSaveNote = async () => {
    setBusy("note");
    try {
      await auditorService.updateNote(auditor.id, note);
      setShowNote(false);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6 px-6 py-6 max-w-5xl">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-muted-foreground">
            <span title={auditor.id}>{middleTruncate(auditor.id)}</span>
          </p>
          <h1 className="text-2xl font-bold tracking-tight">{auditor.displayName}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant={auditor.status === "active" ? "default" : "outline"}>
              {auditor.status === "active" ? "활성" : "정지"}
            </Badge>
            <span>등록 {formatDate(auditor.createdAt)}</span>
            {auditor.lastActiveAt && (
              <>
                <span>·</span>
                <span>최근 활동 {formatDate(auditor.lastActiveAt)}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/auditors" className="text-sm underline">
            ← 목록
          </Link>
        </div>
      </header>

      {/* 계정 정보 */}
      <section className="rounded-xl border bg-card">
        <header className="border-b px-4 py-2 text-sm font-semibold">계정 정보</header>
        <dl className="divide-y text-sm">
          <Row label="이메일" value={auditor.email} />
          {auditor.phone && <Row label="휴대폰" value={auditor.phone} />}
          <Row
            label="자격"
            value={
              auditor.qualifications.length === 0 ? (
                <span className="text-muted-foreground">없음</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {auditor.qualifications.map((q) => (
                    <Badge key={q} variant="outline" className="text-[10px]">
                      {q}
                    </Badge>
                  ))}
                </div>
              )
            }
          />
          {auditor.note && !showNote && <Row label="메모" value={auditor.note} />}
        </dl>
        {showNote && (
          <div className="border-t px-4 py-3">
            <label className="text-xs font-medium text-muted-foreground">
              관리자 메모
            </label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="mt-1"
              placeholder="이 평가자에 대한 관리 메모"
            />
            <div className="mt-2 flex justify-end gap-1">
              <Button variant="ghost" onClick={() => setShowNote(false)}>
                취소
              </Button>
              <Button onClick={onSaveNote} disabled={busy !== null}>
                저장
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* 통계 */}
      <section className="grid grid-cols-2 gap-2 divide-x-0 rounded-xl border bg-card md:grid-cols-4 md:gap-0 md:divide-x">
        <Cell label="누적 Audit" value={myAudits.length} />
        <Cell label="인정 / 거절" value={`${accepted} / ${rejected}`} />
        <Cell
          label="인정률"
          value={acceptanceRate === null ? "—" : `${Math.round(acceptanceRate * 100)}%`}
        />
        <Cell label="크레딧" value={`${totalCredit} cr`} />
      </section>

      {/* 활동 / Audit 이력 */}
      <section className="rounded-xl border bg-card">
        <header className="border-b px-4 py-2 text-sm font-semibold">
          <ListChecks className="mr-1 inline-block size-3.5" />
          Audit 이력 ({myAudits.length})
        </header>
        {myAudits.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            아직 audit 이력이 없습니다.
          </p>
        ) : (
          <ul className="divide-y text-sm">
            {myAudits.slice(0, 12).map((a) => {
              const conv = conversations[a.conversationId];
              const review = reviews.find((r) => r.auditId === a.id);
              return (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/admin/inspection/${a.id}`}
                      className="font-mono text-xs hover:underline"
                      title={a.id}
                    >
                      {middleTruncate(a.id)}
                    </Link>
                    <div className="text-sm">
                      {conv?.topic.title ?? a.conversationId}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      픽업 {formatDate(a.pickedAt)}
                      {a.submittedAt && ` · 제출 ${formatDate(a.submittedAt)}`}
                      {review?.finalizedAt && ` · 검수 ${formatDate(review.finalizedAt)}`}
                    </div>
                  </div>
                  <Badge variant={auditStatusVariant(a.status)}>
                    {AUDIT_STATUS_LABEL[a.status]}
                  </Badge>
                </li>
              );
            })}
            {myAudits.length > 12 && (
              <li className="px-4 py-2 text-xs text-muted-foreground">
                … 나머지 {myAudits.length - 12}건
              </li>
            )}
          </ul>
        )}
      </section>

      {/* 정산 이력 */}
      <section className="rounded-xl border bg-card">
        <header className="border-b px-4 py-2 text-sm font-semibold">
          기여 / 정산 이력 ({myLedger.length}) · {settlementCount} 회차
        </header>
        {myLedger.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            ledger 이력이 없습니다.
          </p>
        ) : (
          <ul className="divide-y text-sm">
            {myLedger.slice(0, 10).map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-3 px-4 py-2 text-xs"
              >
                <div className="min-w-0">
                  <span className="font-medium">{LEDGER_KIND_LABEL[e.kind] ?? e.kind}</span>
                  {e.note && (
                    <span className="ml-1 text-muted-foreground">— {e.note}</span>
                  )}
                  <div className="text-[10px] text-muted-foreground">
                    {formatDateTime(e.timestamp)}
                    {e.sourceRef.kind === "audit" && (
                      <> · audit <span title={e.sourceRef.auditId}>{middleTruncate(e.sourceRef.auditId)}</span></>
                    )}
                    {e.sourceRef.kind === "settlement" && (
                      <> · 회차 {e.sourceRef.roundId}</>
                    )}
                  </div>
                </div>
                <div className="text-right tabular-nums">
                  <div
                    className={cn(
                      "font-medium",
                      e.amount > 0 && "text-emerald-700",
                      e.amount < 0 && "text-rose-700",
                    )}
                  >
                    {e.amount > 0 ? `+${e.amount}` : e.amount} cr
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    잔액 {e.balanceAfter}
                  </div>
                </div>
              </li>
            ))}
            {myLedger.length > 10 && (
              <li className="px-4 py-2 text-xs text-muted-foreground">
                … 나머지 {myLedger.length - 10}건
              </li>
            )}
          </ul>
        )}
      </section>

      {/* 액션 */}
      <section className="rounded-xl border bg-card">
        <header className="border-b px-4 py-2 text-sm font-semibold">액션</header>
        <div className="flex flex-wrap gap-2 px-4 py-3">
          {auditor.status === "active" ? (
            <Button
              variant="destructive"
              onClick={onToggleStatus}
              disabled={busy !== null}
            >
              <ShieldOff className="size-3.5" />
              {busy === "status" ? "처리 중…" : "정지"}
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={onToggleStatus}
              disabled={busy !== null}
            >
              <ShieldCheck className="size-3.5" />
              {busy === "status" ? "처리 중…" : "복구"}
            </Button>
          )}
          <Button
            variant="outline"
            render={
              <Link
                href={`/admin/mail/new?to=${encodeURIComponent(auditor.id)}`}
              />
            }
          >
            <MailPlus className="size-3.5" />
            우편 보내기
          </Button>
          <Button
            variant="ghost"
            onClick={() => setShowNote((v) => !v)}
          >
            <CheckCircle2 className="size-3.5" />
            {showNote ? "메모 닫기" : auditor.note ? "메모 수정" : "메모 추가"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 px-4 py-2">
      <dt className="w-20 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="flex-1 text-sm">{value}</dd>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
