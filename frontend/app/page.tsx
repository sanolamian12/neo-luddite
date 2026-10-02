import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PublicHeader } from "@/components/layout/public-header";

export default function Home() {
  return <>
    <PublicHeader />
    <main className="ds-landing">
      <div className="ds-landing-content">
        <h1>세금 고민,<br />대화로 풀어드립니다</h1>
        <p>업종에 맞는 세무 상담을 시작하고,<br />필요할 때 전문가에게 연결하세요.</p>
        <Link href="/login" className={buttonVariants({ size: "lg" })}>상담 시작하기<ArrowRight size={18} /></Link>
      </div>
    </main>
  </>;
}
