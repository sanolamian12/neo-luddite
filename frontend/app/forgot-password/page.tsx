import { Suspense } from "react";
import { ForgotPasswordScreen } from "@/components/auth/password-recovery-screen";

export default function ForgotPasswordPage() {
  return <Suspense fallback={<p role="status" className="p-6">비밀번호 재설정을 준비하는 중…</p>}><ForgotPasswordScreen /></Suspense>;
}
