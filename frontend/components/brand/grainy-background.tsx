"use client";

import { useAccountHydrated, useAccountStore } from "@/lib/account-store";

/**
 * 배경 텍스처: 역할별 브랜드 그라데이션 + SVG 노이즈(그레인).
 * 고정 레이어로 전 페이지 뒤에 깔린다. (성능: 정적, pointer-events 없음)
 * 로그인 역할(session)에 따라 그라데이션 색을 바꿔 환경을 구분한다.
 */
const NOISE_SVG = encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>
     <filter id='n'>
       <feTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/>
       <feColorMatrix type='saturate' values='0'/>
     </filter>
     <rect width='100%' height='100%' filter='url(#n)'/>
   </svg>`,
);

const ROLE_GRADIENT: Record<string, { from: string; to: string }> = {
  viewer: { from: "var(--brand-blue)", to: "oklch(0.7 0.13 200)" },
  auditor: { from: "var(--brand-green)", to: "oklch(0.72 0.13 195)" },
  admin: { from: "var(--brand-amber)", to: "oklch(0.7 0.17 40)" },
};

const DEFAULT_GRADIENT = { from: "var(--brand-blue)", to: "var(--brand-green)" };

export function GrainyBackground() {
  const hydrated = useAccountHydrated();
  const session = useAccountStore((s) => s.session);
  const grad = (hydrated && session && ROLE_GRADIENT[session]) || DEFAULT_GRADIENT;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* 베이스 */}
      <div className="absolute inset-0 bg-background" />
      {/* 역할별 소프트 그라데이션 */}
      <div
        className="absolute inset-0 opacity-[0.16] transition-opacity duration-500 dark:opacity-[0.22]"
        style={{
          backgroundImage: `
            radial-gradient(60rem 60rem at 12% -10%, ${grad.from}, transparent 60%),
            radial-gradient(50rem 50rem at 100% 110%, ${grad.to}, transparent 55%)
          `,
        }}
      />
      {/* 그레인(노이즈) */}
      <div
        className="absolute inset-0 opacity-[0.05] dark:opacity-[0.08] mix-blend-overlay"
        style={{ backgroundImage: `url("data:image/svg+xml,${NOISE_SVG}")` }}
      />
    </div>
  );
}
