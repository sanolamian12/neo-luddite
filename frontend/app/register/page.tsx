import { Suspense } from "react";
import { AuthScreen } from "@/components/auth/auth-screen";

export default function RegisterPage() {
  return <Suspense fallback={<p className="p-6" role="status">회원가입을 준비하는 중…</p>}><AuthScreen mode="register" /></Suspense>;
}
