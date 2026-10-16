"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, MailPlus, ShieldOff, ShieldCheck, UserMinus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isPrototype } from "@/lib/data-mode";
import type { AuditorEntry } from "@/lib/poc-schema";
import {
  useAuditorRegistryHydrated,
  useAuditorRegistryStore,
} from "@/lib/auditor-registry-store";
import { useLedgerHydrated, useLedgerStore } from "@/lib/ledger-store";
import { formatDate } from "@/lib/poc-format";
import { middleTruncate } from "@/lib/utils";
import { EntriesTable } from "@/components/auditor/ledger-view";
import * as auditorService from "@/services/auditor";
import { LoadingBlock } from "@/components/ui/spinner";

const STATUS_LABEL: Record<AuditorEntry["status"], string> = {
  active: "활성",
  suspended: "정지",
  revoked: "승인 취소",
};

const REVOKE_CONFIRM_WORD = "승인 취소";

export function AuditorDetailView({ auditorId }: { auditorId: string }) {
  const regHydrated = useAuditorRegistryHydrated();
  const ledgerHydrated = useLedgerHydrated();
  const auditors = useAuditorRegistryStore((s) => s.auditors);
  const ledger = useLedgerStore((s) => s.entries);

  const auditor = useMemo(
    () => auditors.find((a) => a.id === auditorId) ?? null,
    [auditors, auditorId],
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
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setNote(auditor?.note ?? "");
  }, [auditor?.note]);

  if (!regHydrated || !ledgerHydrated) {
    return <LoadingBlock label="로딩 중…" />;
  }
  if (!auditor) {
    return (
      <div className="px-6 py-10">
        <h1 className="text-2xl font-bold">세무사를 찾을 수 없습니다</h1>
        <Link href="/admin/auditors" className="mt-2 inline-block text-sm underline">
          ← 목록
        </Link>
      </div>
    );
  }

  // 기여 요약 — 지금 쌓이는 기여는 공용 KB 사례 반영·철회(0056). 옛 검수 행은 잔액에만 남는다.
  const totalCredit = myLedger[0]?.balanceAfter ?? 0;
  let sharedNow = 0;
  let sharedEvents = 0;
  for (const e of myLedger) {
    if (e.sourceRef.kind !== "kb3_share") continue;
    sharedEvents += 1;
    sharedNow += e.sourceRef.event === "approved" ? 1 : -1;
  }

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
    <div className="ds-page flex flex-col gap-8">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-muted-foreground">
            <span title={auditor.id}>{middleTruncate(auditor.id)}</span>
          </p>
          <h1 className="text-2xl font-bold tracking-tight">{auditor.displayName}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant={auditor.status === "active" ? "default" : "outline"}>
              {STATUS_LABEL[auditor.status]}
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
      <section className="ds-panel">
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
              placeholder="이 세무사에 대한 관리 메모"
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

      {/* 기여 요약 */}
      <section className="grid grid-cols-1 gap-2 ds-panel sm:grid-cols-3 sm:gap-0 sm:divide-x">
        <Cell label="크레딧" value={`${totalCredit} cr`} />
        <Cell label="공용 KB 반영 사례" value={Math.max(0, sharedNow)} />
        <Cell label="반영·철회 기록" value={sharedEvents} />
      </section>

      {/* 기여 내역 */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">기여 내역 ({myLedger.length})</h2>
        <EntriesTable entries={myLedger.slice(0, 20)} />
        {myLedger.length > 20 && (
          <p className="text-xs text-muted-foreground">… 나머지 {myLedger.length - 20}건</p>
        )}
      </section>

      {/* 액션 */}
      <section className="ds-panel">
        <header className="border-b px-4 py-2 text-sm font-semibold">액션</header>
        {notice && <p role="status" className="border-b px-4 py-2 text-sm">{notice}</p>}
        {auditor.status === "revoked" && (
          <p className="border-b px-4 py-2 text-sm text-muted-foreground">
            승인이 취소된 세무사예요. 계정은 일반 회원으로 바뀌었고, 다시 신청하면 승인 시 이 기록이 이어집니다.
          </p>
        )}
        <div className="flex flex-wrap gap-2 px-4 py-3">
          {auditor.status === "revoked" ? null : auditor.status === "active" ? (
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
          {auditor.status !== "revoked" && !isPrototype && (
            <Button
              variant="outline"
              className="text-destructive"
              onClick={() => { setNotice(null); setRevokeOpen(true); }}
              disabled={busy !== null}
            >
              <UserMinus className="size-3.5" />
              승인 취소
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

      <Dialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        {/* 열 때마다 다시 마운트 — 사유·확인 문구·미리보기가 이전 시도에서 넘어오지 않게 */}
        {revokeOpen && (
          <RevokeForm
            auditor={auditor}
            onClose={() => setRevokeOpen(false)}
            onDone={(r) => {
              setRevokeOpen(false);
              setNotice(
                `승인을 취소했어요 — 상담 신청 거절 ${r.requestsDeclined}·종료 ${r.requestsCompleted}, 제안 철회 ${r.offersWithdrawn}, ` +
                  `채팅방 종료 ${r.roomsClosed}, 사례 보관 ${r.expertCasesArchived}.`,
              );
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function RevokeForm({
  auditor,
  onClose,
  onDone,
}: {
  auditor: AuditorEntry;
  onClose: () => void;
  onDone: (result: auditorService.RevokeResult) => void;
}) {
  const [preview, setPreview] = useState<auditorService.RevokePreview | null>(null);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    auditorService
      .revokePreview(auditor.id)
      .then((p) => { if (alive) setPreview(p); })
      .catch((cause) => { if (alive) setError(auditorService.revokeErrorMessage(cause)); });
    return () => { alive = false; };
  }, [auditor.id]);

  const ready = reason.trim().length > 0 && confirm.trim() === REVOKE_CONFIRM_WORD && !busy;

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await auditorService.revoke(auditor.id, reason.trim()));
    } catch (cause) {
      setError(auditorService.revokeErrorMessage(cause));
      setBusy(false);
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{auditor.displayName} 세무사 승인 취소</DialogTitle>
        <DialogDescription>
          이 계정은 일반 회원이 되고 세무사 카드가 사라져요. 진행 중인 상담은 정리되고 고객에게는 &lsquo;세무사 사정&rsquo;으로 안내돼요.
          기여 기록은 보존되며, 다시 신청해 승인되면 이어집니다.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        {preview ? (
          <ul className="grid grid-cols-1 gap-x-4 gap-y-1 rounded-md border px-3 py-2 text-sm sm:grid-cols-2">
            <li>대기 상담 신청 → 거절 <b className="tabular-nums">{preview.requestsPending}</b></li>
            <li>진행 중 상담 → 종료 <b className="tabular-nums">{preview.requestsAccepted}</b></li>
            <li>대기 연결 제안 → 철회 <b className="tabular-nums">{preview.offersPending}</b></li>
            <li>열린 채팅방 → 종료 <b className="tabular-nums">{preview.roomsOpen}</b></li>
            <li>세무사 사례 → 보관 <b className="tabular-nums">{preview.expertCases}</b>{preview.sharedCases > 0 && ` (공용 ${preview.sharedCases})`}</li>
            <li>기여 기록(보존) <b className="tabular-nums">{preview.ledgerEntries}</b></li>
          </ul>
        ) : (
          !error && <p className="text-sm text-muted-foreground">영향 범위를 불러오는 중…</p>
        )}
        <div className="flex flex-col gap-1">
          <Label htmlFor="revoke-reason">취소 사유 (신청자에게 보여요)</Label>
          <Textarea id="revoke-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="revoke-confirm">확인을 위해 &lsquo;{REVOKE_CONFIRM_WORD}&rsquo;를 입력해 주세요</Label>
          <Input id="revoke-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>닫기</Button>
        <Button variant="destructive" onClick={() => void submit()} disabled={!ready}>
          {busy ? "처리하는 중…" : "승인 취소"}
        </Button>
      </DialogFooter>
    </DialogContent>
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
