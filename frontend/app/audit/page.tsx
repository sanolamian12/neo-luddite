import { redirect } from "next/navigation";

/** /audit 진입 시 기여 통장 대시보드로 보낸다 (PoC 부터 기본 랜딩 변경). */
export default function AuditRootPage() {
  redirect("/audit/dashboard");
}
