"use client";

import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ConversationReadOnly, errorMessage } from "@/components/consultation/consultation-parts";
import type { Conversation } from "@/lib/conversation-schema";
import { MASK_RULES, type MaskReport, type PoolConsentState } from "@/lib/poc-schema";
import { cn } from "@/lib/utils";
import * as casePool from "@/services/case-pool";

/**
 * 비식별 상담사 풀 — 사장님 동의 시트·추적 화면과 세무사 풀 화면이 함께 쓰는 조각.
 * 고지 문구는 설계 §3.2·§4.2 그대로: 규칙으로 못 지우는 문맥 단서가 남는다는 것을 숨기지 않는다.
 */

export const OWNER_POOL_NOTICE =
  "전화·이메일·사업자번호·주민번호·계좌·카드·주소·상호·이름은 규칙으로 가립니다. " +
  "지역·개원 연차·금액대 같은 문맥은 남으므로 완전한 익명은 아닙니다. " +
  `${casePool.POOL_CONSENT_DAYS}일 뒤 자동으로 내려가고, 언제든 철회할 수 있습니다.`;

export const EXPERT_POOL_NOTICE =
  "개인정보는 규칙으로 가렸습니다. 완전한 익명은 아닙니다. 사례 밖 용도로 쓰지 마세요.";

/** {규칙: 건수} → 칩. 아무것도 안 가렸으면 그렇게 말한다(0건도 정보다). */
export function MaskReportChips({ report, className }: { report: MaskReport; className?: string }) {
  const items = MASK_RULES.filter((r) => (report[r] ?? 0) > 0);
  if (!items.length) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        규칙에 걸린 개인정보가 없습니다(가려진 항목 0건).
      </p>
    );
  }
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {items.map((r) => (
        <Badge key={r} variant="outline" className="border-transparent bg-muted text-[11px]">
          {r} {report[r]}건
        </Badge>
      ))}
    </div>
  );
}

export function PoolNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-brand-amber/40 bg-brand-amber/5 px-3 py-2 text-xs break-keep">
      <ShieldAlert className="mt-0.5 size-4 shrink-0 text-brand-amber" />
      <p>{children}</p>
    </div>
  );
}

const STATE_LABEL: Record<PoolConsentState, string> = {
  active: "풀에 공개 중",
  expired: "만료됨",
  revoked: "철회함",
};

const STATE_CLASS: Record<PoolConsentState, string> = {
  active: "bg-brand-green/15 text-brand-green",
  expired: "bg-muted text-muted-foreground",
  revoked: "bg-muted text-muted-foreground",
};

export function PoolConsentBadge({ state }: { state: PoolConsentState }) {
  return (
    <Badge variant="outline" className={cn("border-transparent", STATE_CLASS[state])}>
      {STATE_LABEL[state]}
    </Badge>
  );
}

/**
 * 마스킹 미리보기 — 동의 전에 "세무사에게 이렇게 보입니다"를 그대로 보여 준다.
 * DB 가 지금의 대화를 마스킹해 돌려준다(저장 안 함). 동의 시 저장되는 사본과 같은 함수다.
 */
export function MaskPreview({ conversationId }: { conversationId: string }) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; payload: Conversation; report: MaskReport }
  >({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    casePool
      .previewMask(conversationId)
      .then((r) => {
        if (alive) setState({ kind: "ready", ...r });
      })
      .catch((e: unknown) => {
        if (alive) setState({ kind: "error", message: errorMessage(e, "미리보기를 불러오지 못했습니다.") });
      });
    return () => {
      alive = false;
    };
  }, [conversationId]);

  if (state.kind === "loading") {
    return <div className="h-32 animate-pulse rounded-xl bg-muted/50" />;
  }
  if (state.kind === "error") {
    return <p className="text-xs text-destructive">{state.message}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium">가려진 항목</p>
        <MaskReportChips report={state.report} />
      </div>
      <div className="max-h-[40vh] overflow-y-auto rounded-xl border bg-muted/20 p-3">
        <ConversationReadOnly conversation={state.payload} />
      </div>
    </div>
  );
}

/** "N일 전" — 풀 카드의 경과일. */
export function daysAgo(ts: number, now: number = Date.now()): string {
  const d = Math.floor((now - ts) / 86_400_000);
  if (d <= 0) return "오늘";
  return `${d}일 전`;
}
