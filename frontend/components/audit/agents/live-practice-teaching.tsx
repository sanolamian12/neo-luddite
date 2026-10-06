"use client";

import { ManualTeaching, type ManualTeachingProps } from "./manual-teaching";
import { saveCaseToServer } from "./expert-server";

/** Existing live manual teaching. Session extraction remains gated until S2. */
export function LivePracticeTeaching({ agentId, ...props }: Omit<ManualTeachingProps, "onApply" | "onContribute"> & { agentId: string }) {
  return <ManualTeaching {...props}
    onApply={async (next) => {
      const entry = next.cases.find((item) => item.id === next.lesson.id);
      if (!entry) return false;
      await saveCaseToServer(agentId, entry);
      props.onChange(next);
      return true;
    }}
    explanation="입력한 사례를 서버에 초안으로 저장합니다. 지식 모음에서 게시하면 연결 상담의 AI가 참고합니다. 확인 질문과 운영 원칙은 상단의 변경 저장으로 보관하세요."
    savedDescription="답변 사례를 서버에 초안으로 저장했습니다. 지식 모음에서 게시하고, 확인 질문은 상단의 변경 저장으로 보관하세요." />;
}
