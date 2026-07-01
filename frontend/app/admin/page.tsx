import { redirect } from "next/navigation";

/** /admin 진입 시 상황실 대시보드로 보낸다. */
export default function AdminRootPage() {
  redirect("/admin/dashboard");
}
