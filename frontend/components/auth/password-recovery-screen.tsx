"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { PublicHeader } from "@/components/layout/public-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginHref, safeReturnPath } from "@/lib/account-route";
import { isPrototype } from "@/lib/data-mode";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { beginPasswordRecovery, changeRecoveredPassword, PasswordRecoveryError, passwordRecoveryHref, requestPasswordReset } from "@/lib/password-recovery";

function RecoveryFrame({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <>
    <PublicHeader showAccount={false} />
    <main className="ds-login">
      <section className="ds-login-story" aria-label="계정 복구 안내">
        <h2>잠시 잊었어도,<br />대화는 그대로.</h2>
        <p>가입한 이메일로 계정을 확인하고 비밀번호를 새로 설정하세요. 내 상담을 다시 이어갈 수 있어요.</p>
      </section>
      <div className="ds-login-form">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h1>{title}</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
          </div>
          {children}
        </div>
      </div>
    </main>
  </>;
}

function loginDestination(returnTo: string | null) {
  const next = safeReturnPath(returnTo);
  return next ? loginHref(next) : "/login";
}

export function ForgotPasswordScreen() {
  const returnTo = useSearchParams().get("next");
  const [email, setEmail] = useState("");
  const [sentEmail, setSentEmail] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [retryAt, setRetryAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const available = !isPrototype && isSupabaseConfigured;

  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setInterval(() => {
      const seconds = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
      setRemaining(seconds);
      if (seconds === 0) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);

  function startCooldown() {
    setRemaining(60);
    setRetryAt(Date.now() + 60_000);
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (pending || remaining > 0 || !available) return;
    setPending(true);
    setError(null);
    try {
      await requestPasswordReset(email, window.location.origin, returnTo);
      setSentEmail(email.trim());
      startCooldown();
    } catch (cause) {
      setError(cause instanceof PasswordRecoveryError ? cause.message : "이메일을 요청하지 못했어요. 연결을 확인하고 다시 시도해 주세요.");
      if (cause instanceof PasswordRecoveryError && cause.kind === "rate_limit") startCooldown();
    } finally { setPending(false); }
  }

  return <RecoveryFrame title={sentEmail ? "이메일을 확인해 주세요" : "비밀번호를 잊으셨나요?"} description={sentEmail ? "재설정 링크를 안내해 드릴게요." : "가입할 때 사용한 이메일 주소를 입력해 주세요."}>
    {sentEmail && <div role="status" className="flex flex-col gap-3 text-sm leading-relaxed">
      <p><strong className="break-all font-medium">{sentEmail}</strong>로 가입한 계정이 있다면 비밀번호 재설정 링크가 전송됩니다.</p>
      <p className="text-muted-foreground">스팸함도 확인해 주세요. 요청한 브라우저에서 가장 최근에 받은 링크를 열어 주세요.</p>
    </div>}
    <form onSubmit={send} className="flex flex-col gap-4" aria-busy={pending}>
      {!sentEmail && <div className="flex flex-col gap-2">
        <Label htmlFor="recovery-email">이메일</Label>
        <Input id="recovery-email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="name@example.com" value={email} onChange={(event) => { setEmail(event.target.value); setError(null); }} required disabled={pending || !available} className="h-11 text-base" aria-describedby="recovery-email-help" />
        <p id="recovery-email-help" className="text-sm leading-relaxed text-muted-foreground">재설정 링크는 요청한 브라우저에서 열어 주세요.</p>
      </div>}
      {!available && <p role="status" className="text-sm text-muted-foreground">{isPrototype ? "데모에서는 재설정 이메일을 보내지 않아요. 로그인 화면의 데모 계정을 이용해 주세요." : "지금은 비밀번호 재설정에 연결할 수 없어요. 잠시 후 다시 시도해 주세요."}</p>}
      {error && <p role="alert" className="text-sm leading-relaxed text-destructive">{error}</p>}
      <Button type="submit" size="lg" disabled={pending || remaining > 0 || !available} className="w-full">
        {pending ? "이메일 요청 중…" : remaining > 0 ? `${remaining}초 후 다시 요청` : sentEmail ? "이메일 다시 요청" : "재설정 링크 받기"}
      </Button>
      {sentEmail && <Button type="button" variant="ghost" size="lg" disabled={pending} onClick={() => { setSentEmail(null); setError(null); }}>이메일 주소 다시 입력</Button>}
    </form>
    <p className="border-t pt-5 text-sm leading-relaxed text-muted-foreground">Google·카카오로 가입했다면 비밀번호를 재설정하지 않아도 돼요. 로그인 화면에서 가입한 소셜 계정을 선택해 주세요.</p>
    <Link href={loginDestination(returnTo)} className="inline-flex min-h-11 items-center justify-center text-sm underline underline-offset-4">로그인으로 돌아가기</Link>
  </RecoveryFrame>;
}

export function ResetPasswordScreen() {
  const returnTo = useSearchParams().get("next");
  const exchange = useRef<Promise<string> | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [stage, setStage] = useState<"checking" | "editing" | "invalid" | "done">("checking");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!exchange.current) {
      const href = window.location.href;
      // Consume the code once, and keep it out of history and subsequent referrers.
      window.history.replaceState(null, "", passwordRecoveryHref("reset", returnTo));
      exchange.current = beginPasswordRecovery(href);
    }
    void exchange.current.then((id) => {
      if (active) { setUserId(id); setStage("editing"); }
    }).catch((cause: unknown) => {
      if (active) {
        setError(cause instanceof PasswordRecoveryError ? cause.message : "링크를 확인하지 못했어요. 연결을 확인하고 이메일을 다시 요청해 주세요.");
        setStage("invalid");
      }
    });
    return () => { active = false; };
  }, [returnTo]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || !userId) return;
    setPending(true);
    setError(null);
    try {
      await changeRecoveredPassword(userId, password, confirmation);
      setPassword("");
      setConfirmation("");
      setStage("done");
    } catch (cause) {
      setError(cause instanceof PasswordRecoveryError ? cause.message : "비밀번호를 변경하지 못했어요. 연결을 확인하고 다시 시도해 주세요.");
      if (cause instanceof PasswordRecoveryError && cause.kind === "link") { setUserId(null); setStage("invalid"); }
    } finally { setPending(false); }
  }

  const title = stage === "checking" ? "링크 확인 중" : stage === "invalid" ? "새 링크가 필요해요" : stage === "done" ? "비밀번호를 변경했어요" : "새 비밀번호 설정";
  const description = stage === "checking" ? "계정을 확인하고 있어요. 잠시만 기다려 주세요." : stage === "invalid" ? "재설정 이메일을 다시 요청해 주세요." : stage === "done" ? "다음 로그인부터 새 비밀번호를 사용해 주세요." : "기존 비밀번호와 다른 새 비밀번호를 입력해 주세요.";
  return <RecoveryFrame title={title} description={description}>
    {stage === "checking" && <p role="status" className="text-sm text-muted-foreground">계정 확인 중…</p>}
    {stage === "editing" && <form onSubmit={submit} className="flex flex-col gap-4" aria-busy={pending}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="new-password">새 비밀번호</Label>
        <Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(event) => { setPassword(event.target.value); setError(null); }} minLength={8} required disabled={pending} className="h-11 text-base" aria-describedby="password-help password-error" />
        <p id="password-help" className="text-sm text-muted-foreground">8자 이상 입력해 주세요.</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm-password">새 비밀번호 확인</Label>
        <Input id="confirm-password" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => { setConfirmation(event.target.value); setError(null); }} minLength={8} required disabled={pending} className="h-11 text-base" aria-describedby="password-error" />
      </div>
      {error && <p id="password-error" role="alert" className="text-sm leading-relaxed text-destructive">{error}</p>}
      <Button type="submit" size="lg" disabled={pending} className="w-full">{pending ? "비밀번호 변경 중…" : "비밀번호 변경"}</Button>
    </form>}
    {stage === "invalid" && <>
      <p role="alert" className="text-sm leading-relaxed text-destructive">{error}</p>
      <Link href={passwordRecoveryHref("forgot", returnTo)} className={buttonVariants({ size: "lg" })}>재설정 이메일 다시 요청</Link>
    </>}
    {stage === "done" && <>
      <p role="status" className="text-sm leading-relaxed text-muted-foreground">비밀번호 변경이 완료되었어요. 로그인된 계정으로 상담을 이어가세요.</p>
      <Link href={loginDestination(returnTo)} className={buttonVariants({ size: "lg" })}>이어서 이용하기</Link>
    </>}
    {stage !== "done" && <Link href={loginDestination(returnTo)} className="inline-flex min-h-11 items-center justify-center text-sm underline underline-offset-4">로그인으로 돌아가기</Link>}
  </RecoveryFrame>;
}
