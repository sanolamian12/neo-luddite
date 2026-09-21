import { ExpertPoolView } from "@/components/case-pool/expert-pool-view";

/** 상담사 풀 — `/audit/pool` 목록, `/audit/pool/<대화id>` 해당 사례를 열고 시작. */
export default async function AuditPoolPage({
  params,
}: {
  params: Promise<{ id?: string[] }>;
}) {
  const { id } = await params;
  const initialId = id?.[0] ? decodeURIComponent(id[0]) : undefined;
  return <ExpertPoolView key={initialId ?? "list"} initialId={initialId} />;
}
