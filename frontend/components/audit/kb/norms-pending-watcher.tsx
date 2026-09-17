"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAccountStore } from "@/lib/account-store";
import { useNormsPendingStore } from "@/lib/norms-pending";
import { remainingLabel } from "./norms-view";

const POLL_MS = 60_000;

/**
 * 세무사 로그인 직후 "확인이 필요한 규범 변경" 팝업(P6 ②, 사용자 결정 2026-09-17) + 배지용 폴링.
 *
 * 같은 제안으로는 브라우저 세션당 한 번만 띄운다(sessionStorage). 새 제안이 공개되면 다시 뜬다.
 * 이의 기간이 1일이라 "로그인하면 먼저 확인"이 침묵 = 동의의 전제다.
 */
export function NormsPendingWatcher() {
  const me = useAccountStore((s) => s.auditor.id);
  const items = useNormsPendingStore((s) => s.items);
  const refresh = useNormsPendingStore((s) => s.refresh);
  const storageKey = `norms-popup-seen:${me}`;
  // 이번 브라우저 세션에서 "나중에/지금 확인"으로 닫은 제안 id. 팝업 여부는 여기서 파생한다.
  const [seen, setSeen] = useState<string[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(storageKey) ?? "[]");
    } catch {
      return [];
    }
  });

  useEffect(() => {
    void refresh(me);
    const t = setInterval(() => void refresh(me), POLL_MS);
    return () => clearInterval(t);
  }, [me, refresh]);

  const open = items.some((d) => d.draft && !seen.includes(d.draft.id));

  const dismiss = () => {
    const ids = [...seen, ...items.map((d) => d.draft?.id ?? "")].filter(Boolean);
    setSeen(ids);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(ids));
    } catch {
      // 저장 못 하면 새로고침 뒤 다시 뜰 뿐
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && dismiss()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="size-5 text-sky-600" />
            확인이 필요한 AI 상담 규범 변경 {items.length}건
          </DialogTitle>
          <DialogDescription>
            공개된 규범 변경은 이의 기간이 끝나면 <strong>이의가 없는 한 자동으로 모든 답변에 반영</strong>됩니다.
            동의하면 승인, 문제가 있으면 기한 전에 이의를 남겨 주세요.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col divide-y rounded-md border text-sm">
          {items.map((d) => (
            <li key={d.name} className="flex flex-col gap-0.5 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{d.title}</span>
                <span className="ml-auto text-xs text-muted-foreground">{remainingLabel(d.draft?.deadlineAt)}</span>
              </div>
              <span className="text-xs break-words text-muted-foreground">
                {d.draft?.publishedBy} · {d.draft?.note}
              </span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={dismiss}>
            나중에
          </Button>
          <Button render={<Link href="/audit/norms" />} onClick={dismiss}>
            지금 확인
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
