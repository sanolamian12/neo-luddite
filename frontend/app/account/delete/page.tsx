"use client";

import { useState } from "react";
import Link from "next/link";
import { PublicHeader } from "@/components/layout/public-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAccountHydrated, useAccountStore } from "@/lib/account-store";
import { DELETE_CONFIRM_WORD, deleteMyAccount } from "@/lib/account-deletion";

/** 회원 탈퇴 — 고객(사장님) 본인만. 세무사·관리자 계정은 관리자에게 요청한다(개인정보처리방침 §6). */
export default function AccountDeletePage() {
  const hydrated = useAccountHydrated();
  const session = useAccountStore((s) => s.session);
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (confirm.trim() !== DELETE_CONFIRM_WORD || pending) return;
    setPending(true);
    setError(null);
    try {
      await deleteMyAccount();
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "탈퇴를 완료하지 못했어요.");
      setPending(false);
    }
  }

  return <>
    <PublicHeader showAccount={!done} />
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 py-14 sm:px-6">
      {done ? <>
        <h1 className="text-2xl font-semibold">탈퇴가 완료되었어요</h1>
        <p role="status" className="leading-relaxed text-muted-foreground">계정과 상담 기록을 모두 삭제했어요. 그동안 이용해 주셔서 감사합니다.</p>
        <Link href="/" className={buttonVariants({ size: "lg" })}>처음 화면으로</Link>
      </> : !hydrated ? <p role="status">계정을 확인하는 중…</p>
      : session !== "viewer" ? <>
        <h1 className="text-2xl font-semibold">회원 탈퇴</h1>
        <p className="leading-relaxed text-muted-foreground">
          {session ? `세무사·운영자 계정의 탈퇴는 개인정보 보호책임자에게 이메일로 요청해 주세요.` : "탈퇴하려면 먼저 로그인해 주세요."}
        </p>
        {session ? <Link href="/privacy" className="text-sm underline underline-offset-4">개인정보처리방침의 연락처 보기</Link>
          : <Link href="/login" className={buttonVariants({ size: "lg" })}>로그인</Link>}
      </> : <>
        <h1 className="text-2xl font-semibold">회원 탈퇴</h1>
        <div className="flex flex-col gap-2 leading-relaxed">
          <p>탈퇴하면 아래 정보가 <strong>즉시, 되돌릴 수 없게</strong> 삭제돼요.</p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            <li>계정 정보(로그인 연결, 이름, 업종)</li>
            <li>모든 상담 대화와 세무사 검수 기록</li>
            <li>세무사 상담 신청, 상담방 메시지</li>
            <li>지식베이스에 반영된 내 질문</li>
          </ul>
          <p className="text-sm text-muted-foreground">Google·카카오 계정 자체는 삭제되지 않아요. 같은 계정으로 다시 가입하면 새 계정으로 시작합니다.</p>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="confirm">확인을 위해 &lsquo;{DELETE_CONFIRM_WORD}&rsquo;를 입력해 주세요</Label>
            <Input id="confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" className="h-10 text-base" />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" variant="destructive" size="lg" disabled={confirm.trim() !== DELETE_CONFIRM_WORD || pending}>
            {pending ? "삭제하는 중…" : "탈퇴하고 모든 기록 삭제"}
          </Button>
          <Link href="/" className="text-center text-sm underline underline-offset-4">취소</Link>
        </form>
      </>}
    </main>
  </>;
}
