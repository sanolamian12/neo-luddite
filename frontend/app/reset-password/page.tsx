import { Suspense } from "react";
import { ResetPasswordScreen } from "@/components/auth/password-recovery-screen";

export default function ResetPasswordPage() {
  return <Suspense fallback={<p role="status" className="p-6">재설정 링크를 확인하는 중…</p>}><ResetPasswordScreen /></Suspense>;
}
