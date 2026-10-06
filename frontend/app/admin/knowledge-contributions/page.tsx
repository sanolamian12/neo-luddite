import { notFound } from "next/navigation";
import { KnowledgeContributionReview } from "@/components/admin/knowledge-contributions";
import { isPrototype } from "@/lib/data-mode";

/** 기여 원장 검토는 아직 브라우저 저장 시연 — live 는 서버 모델(프로토타입UI_1006 설계 S3) 전까지 숨긴다. 세무사 쪽 /audit/contributions 와 같은 게이트. */
export default function KnowledgeContributionsPage() {
  if (!isPrototype) notFound();
  return <KnowledgeContributionReview />;
}
