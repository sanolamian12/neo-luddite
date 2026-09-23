"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 관리자 상담 운영 탭(§4.3)이 함께 쓰는 조각 — 집계 타일 · 브레이크 확인 단계 · 카드 줄.
 *
 * 브레이크(방 강제 종료 · 동의 강제 철회 · 대기 제안 거절/철회)는 **되돌릴 수 없고 당사자에게
 * 아무 설명도 가지 않는다**(사용자 결정 2026-09-23: 강제 조치 알림 없음 — 알리려면 DB 가 필요하다).
 * 그래서 한 번 더 묻되, `window.confirm` 이 아니라 화면 안에서 결과를 문장으로 보여 주고 받는다.
 */

export function StatTile({
  label,
  value,
  active = false,
  warn = false,
  onClick,
  testId,
}: {
  label: string;
  value: number;
  active?: boolean;
  warn?: boolean;
  onClick?: () => void;
  testId?: string;
}) {
  const className = cn(
    "flex h-auto flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left",
    active && "border-primary bg-primary/5",
  );
  const body = (
    <>
      <span className="text-[11px] font-normal text-muted-foreground">{label}</span>
      <span className={cn("text-lg font-semibold tabular-nums", warn && "text-brand-amber")}>
        {value}
      </span>
    </>
  );
  if (!onClick) {
    return (
      <div className={className} data-testid={testId}>
        {body}
      </div>
    );
  }
  return (
    <Button
      variant="outline"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={className}
    >
      {body}
    </Button>
  );
}

/**
 * 확인 단계를 거치는 강제 조치 버튼. 누르면 같은 자리에서 경고 문구 + [확인]/[취소] 로 바뀐다.
 * 진행 중에는 두 버튼 다 잠근다(같은 조치가 두 번 가지 않게).
 */
export function ConfirmAction({
  label,
  confirmLabel = "확인",
  warning,
  onConfirm,
  testId,
  disabled = false,
}: {
  label: string;
  confirmLabel?: string;
  warning: string;
  onConfirm: () => Promise<void>;
  testId?: string;
  disabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!asking) {
    return (
      <div className="flex flex-col gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => {
            setError(null);
            setAsking(true);
          }}
          data-testid={testId}
        >
          {label}
        </Button>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-brand-amber/40 bg-brand-amber/5 p-2">
      <p className="text-xs break-keep" data-testid={testId ? `${testId}-warning` : undefined}>
        {warning}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="destructive"
          size="sm"
          disabled={busy}
          data-testid={testId ? `${testId}-confirm` : undefined}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onConfirm();
              setAsking(false);
            } catch (e) {
              setError(
                e && typeof e === "object" && "message" in e
                  ? String((e as { message: unknown }).message)
                  : "처리하지 못했습니다.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "처리 중…" : confirmLabel}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setAsking(false)}>
          취소
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

/** 목록 한 줄 — 412px 에서도 테이블이 아니라 카드다(모바일 컨벤션). */
export function OpsCard({
  children,
  testId,
}: {
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <li className="flex flex-col gap-2 border-b px-4 py-3 md:px-6" data-testid={testId}>
      {children}
    </li>
  );
}

/** 카드 안 "이름: 값" 한 줄들 — 줄바꿈되게 두고 가로 스크롤을 만들지 않는다. */
export function OpsMeta({ items }: { items: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map(([k, v]) => (
        <div key={k} className="flex min-w-0 gap-1">
          <dt className="shrink-0">{k}</dt>
          <dd className="min-w-0 break-all text-foreground">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EmptyRow({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-6 text-sm text-muted-foreground md:px-6">{children}</p>;
}
