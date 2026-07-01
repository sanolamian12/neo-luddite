"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { OCCUPATIONS, type Occupation } from "@/lib/occupations";
import { useAppStore } from "@/lib/store";
import { useAccountStore } from "@/lib/account-store";
import { RoleGuard } from "@/components/auth/role-guard";

export default function SelectPage() {
  return (
    <RoleGuard role="viewer">
      <SelectInner />
    </RoleGuard>
  );
}

function SelectInner() {
  const router = useRouter();
  const setOccupation = useAppStore((s) => s.setOccupation);
  const setViewerOccupation = useAccountStore((s) => s.setViewerOccupation);

  function handleSelect(occ: Occupation) {
    if (occ.status !== "active") return;
    setOccupation(occ.key);
    setViewerOccupation(occ.key);
    router.push(`/chat/${occ.key}`);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
      <Link
        href="/"
        className="mb-8 text-sm text-muted-foreground hover:underline"
      >
        ← 홈으로
      </Link>
      <h1 className="text-4xl font-bold tracking-tight">업종을 선택하세요</h1>
      <p className="mt-2 text-muted-foreground">
        업종에 맞는 세무 상담 흐름으로 안내합니다.
      </p>

      <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {OCCUPATIONS.map((occ) => {
          const active = occ.status === "active";
          return (
            <button
              key={occ.key}
              type="button"
              onClick={() => handleSelect(occ)}
              disabled={!active}
              aria-disabled={!active}
              className={[
                "group relative flex flex-col items-start gap-2 rounded-xl border p-6 text-left transition",
                active
                  ? "cursor-pointer hover:border-foreground hover:shadow-sm"
                  : "cursor-not-allowed opacity-60",
              ].join(" ")}
            >
              <span className="text-3xl">{occ.emoji}</span>
              <span className="text-lg font-semibold">{occ.label}</span>
              <span className="text-sm text-muted-foreground">
                {occ.description}
              </span>
              {!active && (
                <span className="absolute right-4 top-4 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                  준비중
                </span>
              )}
            </button>
          );
        })}
      </div>
    </main>
  );
}
