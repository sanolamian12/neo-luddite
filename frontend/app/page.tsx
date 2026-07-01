import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <div className="flex max-w-2xl flex-col items-center gap-6">
        <span className="inline-flex items-center gap-2 rounded-full border bg-background/60 px-4 py-1 text-sm text-muted-foreground backdrop-blur">
          <span className="size-2 rounded-full bg-brand-green shadow-[0_0_8px_var(--brand-green)]" />
          소상공인을 위한 AI 세무 상담
        </span>
        <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">
          세금 고민,{" "}
          <span className="bg-gradient-to-r from-brand-blue to-brand-green bg-clip-text text-transparent">
            대화로
          </span>{" "}
          <br className="sm:hidden" />
          풀어드립니다
        </h1>
        <p className="max-w-md text-lg text-muted-foreground">
          업종에 맞는 세무 상담을 챗봇과 대화하듯 진행하세요. 실제 심판·판례에
          근거한 답변을 제공합니다.
        </p>
        <Link
          href="/login"
          className={buttonVariants({
            size: "lg",
            className:
              "mt-2 shadow-[0_0_0_1px_var(--brand-green)] transition-shadow hover:shadow-[0_0_16px_-2px_var(--brand-green)]",
          })}
        >
          상담 시작하기
        </Link>
      </div>
    </main>
  );
}
