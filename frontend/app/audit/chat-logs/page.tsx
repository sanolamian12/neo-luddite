import Link from "next/link";
import { conversations } from "@/lib/load-conversation";
import { getOccupation } from "@/lib/occupations";

/**
 * 챗 감사 섹션 인덱스 — 세션 선택 랜딩.
 * B2에서 워크스페이스 큐 스트립이 도입되면 단순 빈 인덱스로 축소될 수 있다.
 */
export default function AuditChatLogsIndexPage() {
  const entries = Object.entries(conversations);

  return (
    <div className="flex-1 overflow-y-auto">
      <main className="w-full px-6 py-10">
        <h1 className="text-2xl font-bold tracking-tight">평가할 세션 선택</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          감사 대상 챗 세션 목록입니다. 라인 단위 피드백과 세션 평가가 가능합니다.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {entries.map(([key, conv]) => {
            const occ = getOccupation(conv.persona.occupation);
            return (
              <Link
                key={key}
                href={`/audit/chat-logs/${key}`}
                className="flex flex-col gap-1 rounded-xl border p-4 transition hover:border-foreground hover:shadow-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-base font-semibold">
                    {conv.topic.title}
                  </span>
                  {occ && (
                    <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                      {occ.emoji} {occ.label}
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {conv.topic.taxCategory} · {conv.messages.length}개 메시지
                </span>
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
