"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, useAnimationControls } from "motion/react";
import { LogIn } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAccountHydrated, useAccountStore } from "@/lib/account-store";
import { DEMO_CREDENTIALS, type AccountId } from "@/lib/account-schema";

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
  const shake = useAnimationControls();

  // 이미 로그인 상태면 본인 랜딩으로 (영속 세션 / 뒤로가기 대비)
  useEffect(() => {
    if (!hydrated || session === null) return;
    router.replace(LANDING[session]);
  }, [hydrated, session, router]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const id = login(username, password);
    if (id) {
      router.replace(LANDING[id]);
      return;
    }
    setError("아이디 또는 비밀번호가 올바르지 않습니다.");
    shake.start({ x: [0, -8, 8, -6, 6, 0], transition: { duration: 0.4 } });
  }

  return (
    <main className="grid min-h-svh lg:grid-cols-2">
      {/* ── LHS 크리에이티브 패널 ─────────────────────────────── */}
      <div className="relative hidden flex-col justify-between overflow-hidden p-12 text-white lg:flex">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-brand-blue via-primary to-brand-green" />
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -z-10 size-[34rem] rounded-full bg-white/20 blur-3xl"
          style={{ top: "-8rem", left: "-6rem" }}
          animate={{ x: [0, 50, 0], y: [0, 40, 0] }}
          transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -z-10 size-[30rem] rounded-full bg-brand-green/40 blur-3xl"
          style={{ bottom: "-8rem", right: "-4rem" }}
          animate={{ x: [0, -40, 0], y: [0, -30, 0] }}
          transition={{ duration: 24, repeat: Infinity, ease: "easeInOut" }}
        />

        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="size-2.5 rounded-full bg-white shadow-[0_0_12px_white]" />
          세무 상담 콘솔
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="max-w-md"
        >
          <h2 className="text-4xl font-bold leading-tight tracking-tight">
            세금 고민,
            <br />
            대화로 풀어드립니다
          </h2>
          <p className="mt-4 text-base text-white/80">
            업종별 AI 세무 상담과 평가·운영을 한곳에서. 실제 심판·판례에 근거한
            답변을 제공합니다.
          </p>
        </motion.div>

        <blockquote className="max-w-md rounded-xl border border-white/20 bg-white/10 p-5 text-sm backdrop-blur">
          <p className="leading-relaxed">
            “복잡한 세무 신고를 채팅 한 번으로 정리했어요. 근거 자료까지 바로
            확인할 수 있어 믿음이 갑니다.”
          </p>
          <footer className="mt-3 text-white/70">— 소상공인 베타 사용자</footer>
        </blockquote>
      </div>

      {/* ── RHS 로그인 폼 ────────────────────────────────────── */}
      <div className="flex items-center justify-center px-6 py-12 sm:px-10">
        <motion.div animate={shake} className="w-full max-w-sm">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-1.5 text-center lg:hidden">
              <span className="mx-auto inline-flex items-center gap-2 rounded-full border bg-background/60 px-4 py-1 text-sm text-muted-foreground backdrop-blur">
                <span className="size-2 rounded-full bg-brand-green shadow-[0_0_8px_var(--brand-green)]" />
                세무 상담 콘솔
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <h1 className="text-2xl font-bold tracking-tight">로그인</h1>
              <p className="text-sm text-muted-foreground">
                아이디와 비밀번호를 입력해 주세요.
              </p>
            </div>

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
                disabled={username.length === 0 || password.length === 0}
                className="h-10 w-full bg-gradient-to-r from-brand-blue to-brand-green text-white shadow-[0_0_16px_-4px_var(--brand-green)] hover:opacity-90"
              >
                <LogIn className="size-4" />
                로그인
              </Button>
            </form>

            <DemoCredentials />

            <Link
              href="/"
              className="text-center text-sm text-muted-foreground hover:underline"
            >
              ← 홈으로
            </Link>
          </div>
        </motion.div>
      </div>
    </main>
  );
}

function DemoCredentials() {
  return (
    <div className="rounded-lg border bg-muted/40 p-3 text-xs">
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
