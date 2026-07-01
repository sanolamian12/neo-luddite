import Link from "next/link";
import { notFound } from "next/navigation";
import { getOccupation } from "@/lib/occupations";
import { buttonVariants } from "@/components/ui/button";
import { ChatExperience } from "@/components/chat/chat-experience";

export default async function ChatPage({
  params,
}: {
  params: Promise<{ occupation: string }>;
}) {
  const { occupation } = await params;
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
          현재는 병의원 상담만 이용할 수 있습니다.
        </p>
        <Link
          href="/select"
          className={buttonVariants({ variant: "outline" })}
        >
          다른 업종 선택
        </Link>
      </div>
    );
  }

  // 활성 직업군 → 대화 재생 챗 경험
  if (!occ.conversationIds?.length) {
    notFound();
  }
  return <ChatExperience occupationKey={occ.key} />;
}
