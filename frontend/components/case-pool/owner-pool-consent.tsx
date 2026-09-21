"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/components/consultation/consultation-parts";
import type { PoolConsent } from "@/lib/poc-schema";
import { formatDateTime } from "@/lib/poc-format";
import * as casePool from "@/services/case-pool";
import { MaskReportChips, PoolConsentBadge } from "./pool-parts";

/**
 * 사장님 /consultations 상세의 "상담사 풀 공개" 칸 — 이 대화의 동의 상태·만료일·[동의 철회].
 * 철회하면 즉시 풀에서 내려가고 비식별 사본도 지워진다(DB). 이미 이어진 상담은 그대로다.
 */
export function OwnerPoolConsent({ conversationId }: { conversationId: string }) {
  const [consent, setConsent] = useState<PoolConsent | null | undefined>(undefined);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    casePool
      .getConsent(conversationId)
      .then((c) => {
        if (alive) setConsent(c);
      })
      .catch(() => {
        if (alive) setConsent(null);
      });
    return () => {
      alive = false;
    };
  }, [conversationId]);

  const onRevoke = async () => {
    setBusy(true);
    setError(null);
    try {
      setConsent(await casePool.revoke(conversationId));
      setConfirm(false);
    } catch (e) {
      setError(errorMessage(e, "철회하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">상담사 풀 공개</h3>
      {consent === undefined ? (
        <div className="h-16 animate-pulse rounded-xl bg-muted/50" />
      ) : consent === null ? (
        <p className="rounded-xl border px-4 py-3 text-sm text-muted-foreground">
          이 대화는 상담사 풀에 올리지 않았습니다. 고른 세무사에게만 전달됩니다.
        </p>
      ) : (
        <PoolConsentDetail
          consent={consent}
          confirm={confirm}
          busy={busy}
          error={error}
          onAskRevoke={() => setConfirm(true)}
          onCancel={() => setConfirm(false)}
          onRevoke={() => void onRevoke()}
        />
      )}
    </section>
  );
}

function PoolConsentDetail({
  consent,
  confirm,
  busy,
  error,
  onAskRevoke,
  onCancel,
  onRevoke,
}: {
  consent: PoolConsent;
  confirm: boolean;
  busy: boolean;
  error: string | null;
  onAskRevoke: () => void;
  onCancel: () => void;
  onRevoke: () => void;
}) {
  const state = casePool.consentState(consent);
  return (
    <div className="flex flex-col gap-2 rounded-xl border px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <PoolConsentBadge state={state} />
        <span className="text-xs text-muted-foreground tabular-nums">
          {state === "revoked"
            ? `철회 ${formatDateTime(consent.revokedAt)}`
            : state === "expired"
              ? `만료 ${formatDateTime(consent.expiresAt)}`
              : `${formatDateTime(consent.expiresAt)}까지 공개`}
        </span>
      </div>
      <p className="text-xs break-keep text-muted-foreground">
        {state === "active"
          ? "비식별 처리한 대화 사본이 세무사들에게 보입니다. 동의한 시점의 대화까지만 올라가 있습니다."
          : "세무사들에게 더 이상 보이지 않습니다."}
      </p>
      <MaskReportChips report={consent.maskReport} />
      {state === "active" &&
        (confirm ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-sm break-keep">풀에서 내릴까요? 이미 이어진 상담은 그대로입니다.</span>
            <Button size="sm" variant="destructive" disabled={busy} onClick={onRevoke}>
              철회하기
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
              돌아가기
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" className="w-fit" onClick={onAskRevoke}>
            동의 철회
          </Button>
        ))}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
