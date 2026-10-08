"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, LogIn } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAccountHydrated, useAccountStore } from "@/lib/account-store";
import { DEMO_CREDENTIALS } from "@/lib/account-schema";
import { isPrototype } from "@/lib/data-mode";
import { PrototypeControls } from "@/components/prototype-controls";
import { SocialButtons } from "./social-buttons";
import { PublicHeader } from "@/components/layout/public-header";
import { destinationAfterLogin, publicReturnPath, safeReturnPath } from "@/lib/account-route";
import { currentChatScope, entryChatStore, useEntryHydrated } from "@/lib/entry-chat-store";

export function AuthScreen({ mode = "login" }: { mode?: "login" | "register" }) {
  const registering = mode === "register";
  const router = useRouter();
  const returnTo = useSearchParams().get("next");
  const hydrated = useAccountHydrated();
  const chatHydrated = useEntryHydrated();
  const session = useAccountStore((s) => s.session);
  const login = useAccountStore((s) => s.login);
  const authError = useAccountStore((s) => s.authError);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigating = useRef(false);

  // 이미 로그인 상태면 본인 랜딩으로 (영속 세션 / 뒤로가기 대비)
  useEffect(() => {
    if (!hydrated || session === null || !chatHydrated || navigating.current) return;
    navigating.current = true;
    const account = useAccountStore.getState()[session];
    const destination = destinationAfterLogin(account, returnTo);
    // 로그인 전에 시작한 게스트 대화를 이 계정 것으로 넘긴다(두 모드 공통).
    const publicPath = publicReturnPath(returnTo);
    const id = publicPath ? new URL(publicPath, "https://local.invalid").searchParams.get("c") ?? undefined : undefined;
    entryChatStore.getState().adopt(id, currentChatScope());
    router.replace(destination);
  }, [hydrated, chatHydrated, session, router, returnTo]);

  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const id = await login(username, password);
      if (id) return;
      setError("아이디 또는 비밀번호가 올바르지 않습니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "로그인하지 못했어요. 입력 내용을 확인하고 다시 시도해 주세요.");
    }
    setSubmitting(false);
  }

  return (
    <>
      <PublicHeader showAccount={false} />
      <main className="ds-login">
        <section className="ds-login-story" aria-label="세무 상담 안내">
          <h2>시작한 대화,<br />그대로 이어가세요.</h2>
          <p>사장님은 내 상담으로, 전문가는 전문가 워크스페이스로. 로그인한 계정에 맞는 공간이 열립니다.</p>
          {isPrototype && <div className="ds-login-note">데모 계정으로 화면을 둘러보세요.<br />샘플 데이터와 변경 내용은 현재 브라우저에 저장됩니다.</div>}
        </section>
        <div className="ds-login-form">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h1>{registering ? "회원가입" : "로그인"}</h1>
              <p className="text-sm text-muted-foreground">{publicReturnPath(returnTo)?.startsWith("/chat/") ? "대화와 작성 중인 질문은 그대로 보관됩니다." : isPrototype ? "아이디와 비밀번호를 입력해 주세요." : registering ? "사용하는 계정으로 간편하게 시작하세요." : "가입한 계정으로 대화를 이어가세요."}</p>
            </div>

            {isPrototype && <PrototypeControls />}

            {!isPrototype && <>
              <SocialButtons returnTo={returnTo} />
              <p className="text-sm leading-relaxed text-muted-foreground">처음이라면 선택한 계정으로 회원가입이 함께 진행돼요. 이미 가입했다면 같은 계정으로 로그인해 주세요.</p>
            </>}
            {registering && <p className="text-sm leading-relaxed text-muted-foreground">{isPrototype ? "데모에서는 로그인 화면의 체험 계정을 이용해 주세요." : "가입 후 업종을 선택하면 상담을 시작할 수 있어요. 전문가·운영자 권한은 승인된 계정에만 부여됩니다."}</p>}
            {authError && !error && <p role="alert" className="text-sm text-destructive">{authError}</p>}
            {!registering && <details open={isPrototype}>
              {!isPrototype && <summary className="cursor-pointer rounded-sm py-2 text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">이메일 또는 기존 아이디로 로그인</summary>}
              <form onSubmit={submit} className="mt-3 flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="username">{isPrototype ? "아이디" : "이메일 또는 기존 아이디"}</Label>
                <Input
                  id="username"
                  value={username}
                  autoComplete="username"
                  placeholder={isPrototype ? "아이디" : "name@example.com"}
                  required
                  autoCapitalize="none"
                  spellCheck={false}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    if (error) setError(null);
                  }}
                  aria-invalid={!!error}
                  className="h-10 text-base"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="password">비밀번호</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  required
                  placeholder="비밀번호"
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError(null);
                  }}
                  aria-invalid={!!error}
                  className="h-10 text-base"
                />
              </div>

              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                size="lg"
                disabled={username.length === 0 || password.length === 0 || submitting}
                className="w-full"
              >
                <LogIn className="size-4" />
                {submitting ? "로그인 중…" : "로그인"}
              </Button>
              </form>
            </details>}

            {isPrototype && !registering && <DemoCredentials />}
            <p className="text-center text-sm text-muted-foreground">
              {registering ? "이미 가입하셨나요? " : "처음 방문하셨나요? "}
              <Link className="font-medium text-foreground underline underline-offset-4" href={`${registering ? "/login" : "/register"}${safeReturnPath(returnTo) ? `?next=${encodeURIComponent(safeReturnPath(returnTo)!)}` : ""}`}>
                {registering ? "로그인" : "회원가입"}
              </Link>
            </p>

            <Link
              href={publicReturnPath(returnTo) ?? "/"}
              className="inline-flex items-center justify-center gap-2 text-sm text-muted-foreground hover:underline"
            >
              <ArrowLeft size={15} />{publicReturnPath(returnTo)?.startsWith("/chat/") ? "로그인 없이 대화로 돌아가기" : "로그인 없이 질문하기"}
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}

function DemoCredentials() {
  return (
    <div className="border-t pt-5 text-xs">
      <p className="mb-2 font-medium text-muted-foreground">데모 계정</p>
      <ul className="flex flex-col gap-1">
        {DEMO_CREDENTIALS.map((c) => (
          <li key={c.username} className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{c.roleLabel}</span>
            <span className="font-mono">
              {c.username} / {c.password}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
