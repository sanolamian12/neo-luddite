"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PublicHeader } from "@/components/layout/public-header";
import { useAccountStore } from "@/lib/account-store";
import { loginHref, publicReturnPath, safeReturnPath } from "@/lib/account-route";
import { exchangeSocialCallback } from "@/lib/social-auth";
import { buttonVariants } from "@/components/ui/button";

export default function CallbackPage() {
  return <Suspense fallback={<p role="status" className="p-6">로그인 확인 중…</p>}><CallbackContent /></Suspense>;
}

function CallbackContent() {
  const router = useRouter();
  const returnTo = useSearchParams().get("next");
  const exchange = useRef<Promise<void> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const retry = safeReturnPath(returnTo) ? loginHref(safeReturnPath(returnTo)!) : "/login";

  useEffect(() => {
    let active = true;
    if (!exchange.current) {
      const href = window.location.href;
      // Do not leave an authorization code or provider error in browser history.
      window.history.replaceState(null, "", `/auth/callback${returnTo ? `?next=${encodeURIComponent(returnTo)}` : ""}`);
      exchange.current = exchangeSocialCallback(href).then(async () => {
        const role = await useAccountStore.getState().syncSession();
        if (!role) throw new Error("로그인 상태를 확인하지 못했어요. 다시 시작해 주세요.");
      });
    }
    void exchange.current.then(() => {
      // Login owns role-safe navigation and the guest conversation handoff.
      if (active) router.replace(retry);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "로그인을 완료하지 못했어요. 다시 시작해 주세요.");
    });
    return () => { active = false; };
  }, [returnTo, retry, router]);

  return <><PublicHeader showAccount={false} /><main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-6 px-6 py-16">
    <h1 className="text-2xl font-semibold">{error ? "로그인을 완료하지 못했어요" : "로그인 확인 중"}</h1>
    <p role={error ? "alert" : "status"} className="text-sm leading-relaxed text-muted-foreground">{error ?? "계정을 확인하고 시작한 대화로 돌아갑니다."}</p>
    {error && <Link href={retry} className={buttonVariants({ size: "lg" })}>로그인 다시 시도</Link>}
    <Link href={publicReturnPath(returnTo) ?? "/"} className="text-sm underline underline-offset-4">로그인 없이 질문하기</Link>
  </main></>;
}
