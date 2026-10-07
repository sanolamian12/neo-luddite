import { Suspense } from "react";
import { AuthScreen } from "@/components/auth/auth-screen";

export default function LoginPage() {
  return <Suspense fallback={<p className="p-6" role="status">로그인을 준비하는 중…</p>}><AuthScreen /></Suspense>;
}
