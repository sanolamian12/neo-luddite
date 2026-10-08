"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { socialAuthorizationUrl, socialProviders, type SocialProvider } from "@/lib/social-auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";

export function SocialButtons({ returnTo }: { returnTo: string | null }) {
  const [pending, setPending] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(provider: SocialProvider) {
    if (pending) return;
    setPending(provider);
    setError(null);
    try {
      const url = await socialAuthorizationUrl(provider, window.location.origin, returnTo);
      window.location.assign(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "로그인을 시작하지 못했어요. 다시 시도해 주세요.");
      setPending(null);
    }
  }

  return <div className="flex flex-col gap-3">
    {socialProviders.map((provider) => <Button key={provider} type="button" variant="outline" size="lg"
      className="h-12 w-full gap-3 text-base" disabled={pending !== null || !isSupabaseConfigured}
      onClick={() => signIn(provider)}>
      {pending === provider ? <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ProviderMark provider={provider} />}
      {pending === provider ? "로그인 연결 중…" : `${provider === "google" ? "Google" : "카카오"}로 계속하기`}
    </Button>)}
    {(!isSupabaseConfigured || socialProviders.length === 0) && <p role="status" className="text-sm text-muted-foreground">지금은 소셜 로그인을 준비 중이에요. 잠시 후 다시 방문해 주세요.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}

function ProviderMark({ provider }: { provider: SocialProvider }) {
  return provider === "google" ? <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5">
    <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.74 2.98-4.31 2.98-7.36Z" />
    <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.97-3.38.97-2.61 0-4.83-1.76-5.62-4.12H3.04v2.59A10 10 0 0 0 12 22Z" />
    <path fill="#FBBC05" d="M6.38 13.93a6 6 0 0 1 0-3.86V7.48H3.04a10 10 0 0 0 0 9.04l3.34-2.59Z" />
    <path fill="#EA4335" d="M12 5.95c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.96 5.48l3.34 2.59A6 6 0 0 1 12 5.95Z" />
  </svg> : <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-current"><path d="M12 3C6.48 3 2 6.54 2 10.9c0 2.82 1.88 5.3 4.7 6.7l-1.2 4.05a.3.3 0 0 0 .46.33l4.75-3.2c.42.04.85.07 1.29.07 5.52 0 10-3.55 10-7.94C22 6.54 17.52 3 12 3Z" /></svg>;
}
