"use client";

import Link from "next/link";
import { useApplicationTheme } from "@/components/design-system/theme";
import { SegmentRenderer } from "./segment-renderer";
import { SpeakerBadge, TaxAgentAvatar } from "./consultation-identity";
import type { Message } from "@/lib/conversation-schema";
import styles from "./answer-table-examples.module.css";

const examples: { title: string; question: string; message: Message }[] = [
  {
    title: "금액을 한눈에 비교하기", question: "제가 정리한 지출을 항목별로 보여 주세요.",
    message: { id: "table-example-simple", role: "assistant", order: 1, segments: [{
      id: "table-example-simple-content", type: "application",
      text: "**요약: 입력한 세 항목의 합계는 2,100,000원입니다.**\n\n| 항목 | 입력한 금액 |\n| --- | ---: |\n| 임차료 | 1,200,000원 |\n| 비품 | 600,000원 |\n| 교통비 | 300,000원 |\n| **합계** | **2,100,000원** |\n\n입력한 금액을 정리한 예시입니다. 비용 인정 여부와 세액은 별도로 확인해야 합니다.",
    }] },
  },
  {
    title: "계산 과정과 전제를 함께 읽기", question: "계산 과정과 확인할 자료도 함께 정리해 주세요.",
    message: { id: "table-example-wide", role: "assistant", order: 1, segments: [{
      id: "table-example-wide-content", type: "application",
      text: "**요약: 계산에 사용한 수치와 확인할 내용을 함께 정리했습니다.**\n\n아래 금액과 비율은 표 표시를 위한 가상 수치입니다. 실제 세법이나 공제율을 적용한 계산이 아닙니다.\n\n| 항목 | 입력 금액 | 예시 비율 | 계산 과정 | 계산 결과 | 확인할 자료 |\n| --- | ---: | ---: | --- | ---: | --- |\n| 항목 A | 1,000,000원 | 60% | 1,000,000 × 60% | 600,000원 | 지출 목적과 사용 내역 |\n| 항목 B | 500,000원 | 40% | 500,000 × 40% | 200,000원 | 영수증 및 관련 계약 |\n| **합계** | **1,500,000원** | — | 600,000 + 200,000 | **800,000원** | 실제 적용 기준은 별도 확인 |\n\n표의 값은 답변에 담긴 그대로 표시합니다. 적용 조건이 달라지면 결과도 달라질 수 있습니다.",
    }] },
  },
];

export function AnswerTableExamples() {
  const { theme, toggleTheme } = useApplicationTheme();
  return <main className={styles.page}>
    <header className={styles.header}><Link href="/">세무상담</Link><button onClick={toggleTheme}>{theme === "light" ? "어두운 테마로 보기" : "밝은 테마로 보기"}</button></header>
    <div className={styles.intro}><h1>답변을 표로 읽기</h1><p>금액은 나란히 비교하고, 계산에 사용한 전제는 함께 확인하세요.</p><small>표 UI 미리보기 · 가상 데이터</small></div>
    {examples.map(example => <section key={example.message.id} className={styles.example} aria-labelledby={`${example.message.id}-title`}>
      <h2 id={`${example.message.id}-title`}>{example.title}</h2>
      <p className={styles.question}>{example.question}</p>
      <div className={styles.answer}><div className={styles.identity}><TaxAgentAvatar size="small" /><strong>세무상담</strong><SpeakerBadge /></div><SegmentRenderer message={example.message} /></div>
    </section>)}
    <footer className={styles.footer}><Link href="/demo">전체 상담 데모 보기</Link></footer>
  </main>;
}
