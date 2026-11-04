import Link from "next/link";
import { notFound } from "next/navigation";
import { getOccupation } from "@/lib/occupations";
import { buttonVariants } from "@/components/ui/button";
import { ChatExperience } from "@/components/chat/chat-experience";

export default async function ChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ occupation: string }>;
  searchParams: Promise<{ c?: string | string[] }>;
}) {
  const { occupation } = await params;
  // ?c=<대화 id> — 다른 화면(세무사 상담 신청 등)에서 특정 라이브 대화를 열고 들어올 때.
  const { c } = await searchParams;
  const openConversationId = typeof c === "string" && c ? c : undefined;
  const occ = getOccupation(occupation);

  // 알 수 없는 직업군 → 404
  if (!occ) {
    notFound();
  }

  // 준비중 직업군 → 안내
  if (occ.status !== "active") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <span className="text-4xl">{occ.emoji}</span>
        <h1 className="text-2xl font-bold">{occ.label} 상담은 준비중입니다</h1>
        <p className="text-muted-foreground">
          사업자 일반 상담으로 질문을 시작할 수 있습니다.
        </p>
        <Link
          href="/chat/general"
          className={buttonVariants({ variant: "outline" })}
        >
          사업자 세무 질문 시작하기
        </Link>
      </div>
    );
  }

  // 활성 직군 → 새 대화 또는 기존 병의원 예시
  if (occ.key !== "general" && !occ.conversationIds?.length) {
    notFound();
  }
  return (
    <ChatExperience occupationKey={occ.key} openConversationId={openConversationId} />
  );
}
