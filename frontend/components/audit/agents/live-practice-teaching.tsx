"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { teachingHref } from "@/lib/agent-navigation";
import type { Practice } from "@/lib/agent-practice";
import { ManualTeaching, type ManualTeachingProps } from "./manual-teaching";
import { SessionTeaching } from "./session-teaching";
import { saveCaseToServer } from "./expert-server";
import css from "./knowledge-growth.module.css";

type Props = Omit<ManualTeachingProps, "onApply" | "onContribute"> & { agentId: string };

/**
 * Live teaching (S2). 원천 = 세무사가 직접 입력·붙여넣은 것만(D-C: 고객 동의 불필요).
 * 반영한 사례는 곧바로 서버 초안(0043)으로, 원문·확인 질문은 상단 '변경 저장'으로 expert_agents 에 보관한다.
 * 채팅방 원문 불러오기는 방 단위 고객 동의(S2b) 뒤에 연다.
 */
export function LivePracticeTeaching({ agentId, ...props }: Props) {
  const router = useRouter(), search = useSearchParams();
  const method = search.get("method") === "session" ? "session" : "manual";
  async function apply(next: Practice, caseId: string | undefined) {
    const entry = caseId ? next.cases.find((item) => item.id === caseId) : undefined;
    if (entry) await saveCaseToServer(agentId, entry);
    props.onChange(next);
    return true;
  }
  return <>
    <div className={css.teachingModes} aria-label="가르치는 방법">
      <button type="button" aria-pressed={method === "manual"} onClick={() => router.push(teachingHref(agentId, "manual"), { scroll: false })}>직접 사례 들려주기</button>
      <button type="button" aria-pressed={method === "session"} onClick={() => router.push(teachingHref(agentId, "session"), { scroll: false })}>상담 전사문으로 가르치기</button>
      <button type="button" disabled title="녹음과 전사는 준비 중입니다">상담 녹음으로 가르치기 · 준비 중</button>
    </div>
    {method === "session"
      ? <SessionTeaching practice={props.practice} onChange={props.onChange} onKnowledge={props.onKnowledge}
          // 반영 = 사례가 생겼을 때만 서버 초안. '상담 메모로 보관'(이 상담에만 해당)은 사례 없이 원문만 남긴다.
          onApply={(next) => apply(next, next.learning?.draft && next.cases.some((item) => item.id === next.learning?.draft?.id) ? next.learning.draft.id : undefined)}
          live={{
            transcriptOnly: true,
            permissionLabel: "내가 진행한 상담이며, 고객을 알아볼 수 있는 정보(이름·연락처·주민번호 등)는 지웠습니다.",
            savedNotice: "답변 사례를 서버에 초안으로 저장했습니다. 원문과 확인 질문은 상단의 변경 저장으로 보관하세요.",
            memoNotice: "상담 메모를 만들었습니다. 상단의 변경 저장을 누르면 서버에 보관됩니다. 재사용 지식에는 추가하지 않았습니다.",
            afterApply: "지식 모음에서 게시한 뒤 공용 KB 로 보낼 수 있습니다.",
          }} />
      : <ManualTeaching {...props}
          onApply={(next) => next.cases.some((item) => item.id === next.lesson.id) ? apply(next, next.lesson.id) : false}
          explanation="입력한 사례를 서버에 초안으로 저장합니다. 지식 모음에서 게시하면 연결 상담의 AI가 참고합니다. 확인 질문과 운영 원칙은 상단의 변경 저장으로 보관하세요."
          savedDescription="답변 사례를 서버에 초안으로 저장했습니다. 지식 모음에서 게시하고, 확인 질문은 상단의 변경 저장으로 보관하세요." />}
  </>;
}
