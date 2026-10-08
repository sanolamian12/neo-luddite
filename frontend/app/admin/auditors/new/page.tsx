import { redirect } from "next/navigation";

/** 관리자가 직접 세무사를 만들던 폼은 가입 신청 → 승인 흐름(0049)으로 대체됐다. */
export default function AdminAuditorNewPage() {
  redirect("/admin/applications");
}
