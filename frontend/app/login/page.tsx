"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, LogIn } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAccountHydrated, useAccountStore } from "@/lib/account-store";
import { DEMO_CREDENTIALS, type AccountId } from "@/lib/account-schema";
import { isPrototype } from "@/lib/data-mode";
import { PrototypeControls } from "@/components/prototype-controls";
import { PublicHeader } from "@/components/layout/public-header";

/** 로그인 후 역할별 랜딩. viewer 는 업종 선택부터 시작한다. */
const LANDING: Record<AccountId, string> = {
  viewer: "/select",
  auditor: "/audit/dashboard",
  admin: "/admin/dashboard",
};

export default function LoginPage() {
  const router = useRouter();
  const hydrated = useAccountHydrated();
  const session = useAccountStore((s) => s.session);
  const login = useAccountStore((s) => s.login);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  // 이미 로그인 상태면 본인 랜딩으로 (영속 세션 / 뒤로가기 대비)
  useEffect(() => {
    if (!hydrated || session === null) return;
    router.replace(LANDING[session]);
  }, [hydrated, session, router]);

  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    const id = await login(username, password);
    setSubmitting(false);
    if (id) {
      router.replace(LANDING[id]);
      return;
    }
    setError("아이디 또는 비밀번호가 올바르지 않습니다.");
  }

  return (
    <>
      <PublicHeader />
      <main className="ds-login">
        <section className="ds-login-story" aria-label="세무 상담 안내">
          <h2>세금 고민,<br />대화로 풀어드립니다</h2>
          <p>업종별 AI 세무 상담과 전문가 연결, 평가와 운영을 하나의 워크스페이스에서 만나보세요.</p>
          {isPrototype && <div className="ds-login-note">데모 계정으로 화면을 둘러보세요.<br />샘플 데이터와 변경 내용은 현재 브라우저에 저장됩니다.</div>}
        </section>
        <div className="ds-login-form">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h1>로그인</h1>
              <p className="text-sm text-muted-foreground">아이디와 비밀번호를 입력해 주세요.</p>
            </div>

            {isPrototype && <PrototypeControls />}

            <form onSubmit={submit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="username">아이디</Label>
                <Input
                  id="username"
                  value={username}
                  autoComplete="username"
                  placeholder="아이디"
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
                로그인
              </Button>
            </form>

            <DemoCredentials />

            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 text-sm text-muted-foreground hover:underline"
            >
              <ArrowLeft size={15} />홈으로
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
