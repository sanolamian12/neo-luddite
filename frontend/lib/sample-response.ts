import type { Message, UiBlock } from "./conversation-schema";

/** Local demonstration data, deliberately separate from a tax determination. */
export function withSampleResponseUi(message: Message, question: string): Message {
  if (message.role !== "assistant" || message.uiBlocks?.length) return message;

  const subject = /차량|리스|운행|자동차/.test(question)
    ? "차량 이용 내역"
    : /골프|접대|거래처|식사/.test(question)
      ? "참석자와 만남의 목적"
      : /헬스|복지|직원|회원권/.test(question)
        ? "이용 대상과 지원 방식"
        : "지출 목적과 이용 대상";
  const uiBlocks: UiBlock[] = [
    {
      kind: "verdict_card", verdict: "조건부", title: "판정 표시 예시",
      summary: "자료 확인 후 판단하는 상황을 보여 주는 샘플입니다. 이 대화의 실제 비용 인정 여부를 판정한 결과는 아닙니다.",
    },
    {
      kind: "evidence_checklist", title: "확인할 자료 · 예시",
      items: [
        { label: subject, required: true, note: "상황을 설명할 때 함께 확인할 내용입니다." },
        { label: "지출 시기·금액과 영수증", required: true, note: "가지고 있는 자료부터 정리해 보세요." },
        { label: "계약서나 추가 설명", required: false, note: "관련 자료가 있다면 함께 준비해 주세요." },
      ],
    },
    {
      kind: "expert_handoff", reason: "질문과 확인할 자료를 정리한 뒤, 샘플 세무사와 상담을 이어가는 흐름을 체험해 보세요.",
      note: "프로토타입 체험입니다. 실제 상담 신청은 전송되지 않습니다.",
    },
  ];
  return {
    ...message,
    segments: message.segments.map((segment, index) => index === 0 ? {
      ...segment,
      framework: segment.framework ?? "입증책임",
      citations: segment.citations?.length ? segment.citations : ["상담 준비 안내 · 가상 출처 예시"],
    } : segment),
    uiBlocks,
  };
}
