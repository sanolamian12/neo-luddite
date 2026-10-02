import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PublicHeader } from "@/components/layout/public-header";

export default function NotFound() {
  return <><PublicHeader /><main className="ds-landing"><div className="ds-landing-content">
    <h1>페이지를 찾을 수 없습니다</h1>
    <p>주소가 변경되었거나 더 이상 제공되지 않는 페이지입니다.</p>
    <Link href="/" className={buttonVariants({ size: "lg" })}><ArrowLeft />홈으로 돌아가기</Link>
  </div></main></>;
}
