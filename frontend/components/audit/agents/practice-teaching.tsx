"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, CircleCheck, Lightbulb, Play, Plus } from "lucide-react";
import { applyLesson, blankLesson, createPractice, validateLesson, type Lesson, type Practice } from "@/lib/agent-practice";
import { SectionTitle, TextField } from "./practice-ui";
import styles from "./agent-practice.module.css";
import { SessionTeaching } from "./session-teaching";
import css from "./knowledge-growth.module.css";

const steps = ["사례 들려주기", "판단 설명하기", "지식 검토하기", "다르게 물어보기"];

type TeachingProps = { practice: Practice; onChange: (practice: Practice) => void; onTest: (query: string) => void; onKnowledge: () => void; onContribute: (id: string) => void };
export function PracticeTeaching(props: TeachingProps) {
  const [method, setMethod] = useState<"session" | "manual">("session");
  return <><div className={css.teachingModes} aria-label="가르치는 방법"><button type="button" aria-pressed={method === "session"} onClick={() => setMethod("session")}>상담에서 배우기</button><button type="button" aria-pressed={method === "manual"} onClick={() => setMethod("manual")}>직접 사례 들려주기</button></div>{method === "session" ? <SessionTeaching {...props} /> : <ManualTeaching {...props} />}</>;
}
function ManualTeaching({ practice, onChange, onTest, onKnowledge, onContribute }: TeachingProps) {
  const [issues, setIssues] = useState<string[]>([]);
  const lesson = practice.lesson;
  const applied = practice.cases.some((item) => item.id === lesson.id);
  function edit(patch: Partial<Lesson>) { setIssues([]); onChange({ ...practice, lesson: { ...lesson, ...patch } }); }
  function next() { const errors = validateLesson(lesson, lesson.step); setIssues(errors); if (!errors.length) edit({ step: Math.min(lesson.step + 1, 3) }); }
  function apply() { try { onChange(applyLesson(practice)); setIssues([]); } catch (error) { setIssues([error instanceof Error ? error.message : "입력한 내용을 확인해 주세요."]); } }
  function sample() {
    const entry = createPractice().cases[0];
    edit({ title: entry.title, facts: entry.facts, judgment: entry.judgment, conclusion: entry.conclusion, exceptions: entry.exceptions, questions: "업무와 개인 용도로 함께 사용하나요?\n구입 증빙이 있나요?", keywords: entry.keywords });
  }
  return <>
    <SectionTitle title="내 에이전트 가르치기" description="상담 사례에 담긴 나의 판단을, 다시 사용할 수 있는 지식으로 만듭니다." />
    <ol className={styles.steps} aria-label="가르치기 진행 단계">{steps.map((label, index) => <li key={label} data-active={lesson.step === index} data-done={lesson.step > index}><span>{lesson.step > index ? <Check size={16} /> : index + 1}</span><strong>{label}</strong></li>)}</ol>
    {issues.length > 0 && <div className={styles.error} role="alert"><ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div>}
    {lesson.step < 3 ? <div className={styles.workbench}>
      <section className={styles.paper} aria-label={steps[lesson.step]}>
        <div className={styles.panelHead}><h3>{lesson.step === 0 ? "어떤 상담이었나요?" : lesson.step === 1 ? "왜 그렇게 판단했나요?" : "이렇게 기억하도록 할까요?"}</h3>{lesson.step === 0 && <button type="button" className={styles.textButton} onClick={sample}>예시로 시작</button>}</div>
        {lesson.step === 0 && <div className={styles.form}>
          <TextField label="사례 이름" value={lesson.title} onChange={(title) => edit({ title })} short maxLength={100} required />
          <TextField label="확인된 사실" value={lesson.facts} onChange={(facts) => edit({ facts })} hint="고객의 상황과 확인한 자료를 적어 주세요." rows={5} required />
          <TextField label="고객에게 전할 답변" value={lesson.conclusion} onChange={(conclusion) => edit({ conclusion })} hint="이 상황에서 내가 실제로 해 줄 답변을 적어 주세요." rows={4} required />
        </div>}
        {lesson.step === 1 && <div className={styles.form}>
          <TextField label="판단한 이유" value={lesson.judgment} onChange={(judgment) => edit({ judgment })} hint="어떤 사실이 중요했고, 어떻게 결론에 도달했나요?" rows={5} required />
          <TextField label="결론이 달라지는 예외" value={lesson.exceptions} onChange={(exceptions) => edit({ exceptions })} hint="무엇이 달라지면 답변을 바꾸거나 직접 참여해야 할까요?" />
          <TextField label="먼저 확인할 질문" value={lesson.questions} onChange={(questions) => edit({ questions })} hint="질문을 한 줄에 하나씩 적어 주세요. 사실 수집에 연결됩니다." />
        </div>}
        {lesson.step === 2 && <div className={styles.form}>
          <p className={styles.hint}>입력한 내용을 지식으로 정리했습니다. 의미와 적용 범위를 확인하고 필요한 부분을 고쳐 주세요.</p>
          <TextField label="사례 이름" value={lesson.title} onChange={(title) => edit({ title })} short maxLength={100} required />
          <TextField label="사실 기반" value={lesson.facts} onChange={(facts) => edit({ facts })} required />
          <TextField label="판단" value={lesson.judgment} onChange={(judgment) => edit({ judgment })} required />
          <TextField label="결론" value={lesson.conclusion} onChange={(conclusion) => edit({ conclusion })} required />
          <TextField label="예외" value={lesson.exceptions} onChange={(exceptions) => edit({ exceptions })} />
          <TextField label="연결할 질문" value={lesson.questions} onChange={(questions) => edit({ questions })} hint="한 줄에 하나씩 입력한 질문이 질문 모음에 함께 반영됩니다." />
          <TextField label="이 사례를 찾을 검색어" value={lesson.keywords} onChange={(keywords) => edit({ keywords })} hint="예: 장비, 구입, 영수증. 쉼표로 구분하며 미리보기의 질문과 연결됩니다." short maxLength={500} required />
        </div>}
        <div className={styles.formFooter}><button type="button" className={styles.secondary} disabled={lesson.step === 0} onClick={() => edit({ step: lesson.step - 1 })}><ArrowLeft size={16} />이전</button><button type="button" className={styles.primary} onClick={lesson.step === 2 ? apply : next}>{lesson.step === 2 ? "검토한 지식 반영" : "다음"}{lesson.step === 2 ? <Check size={16} /> : <ArrowRight size={16} />}</button></div>
      </section>
      <aside className={styles.teachingAside}>
        <Lightbulb size={25} strokeWidth={1.5} />
        <h3>{lesson.step === 0 ? "나의 경험이 출발점입니다" : lesson.step === 1 ? "정답에 이르는 나만의 기준" : "내가 확인한 지식만 사용합니다"}</h3>
        <p>{lesson.step === 0 ? "익숙한 상담 하나면 충분합니다. 고객에게 설명하듯 상황과 답변을 들려주세요." : lesson.step === 1 ? "무엇을 먼저 확인하는지, 언제 판단을 보류하는지. 그 차이에 전문가의 노하우가 담겨 있습니다." : "사실과 판단, 결론을 따로 확인하세요. 연결된 질문은 다음 상담의 사실 수집에 사용됩니다."}</p>
        <div className={styles.knowledgeThread}>{[{ label: "사실", value: lesson.facts }, { label: "판단", value: lesson.judgment }, { label: "결론", value: lesson.conclusion }].map(({ label, value }) => <div key={label} data-filled={!!value.trim()}><span className={styles.threadPoint} /><strong>{label}</strong><p>{value || "아직 들려주지 않은 이야기"}</p></div>)}</div>
        <p className={styles.hint}>이 프로토타입은 입력한 내용을 정리합니다. 새 판단을 추론하거나 모델을 학습시키지 않습니다.</p>
      </aside>
    </div> : <section className={styles.complete}>
      <CircleCheck size={44} strokeWidth={1.4} /><h3>{applied ? "나의 판단이 지식에 담겼습니다" : "다시 검토해 주세요"}</h3><p>“{lesson.title}”의 사실, 판단, 결론과 질문을 연결했습니다.<br />상단의 변경 저장으로 이 브라우저에 보관하세요.</p>
      <div className={styles.actions}><button type="button" className={styles.primary} onClick={() => onTest(lesson.keywords.split(/[,\n]/)[0].trim())}><Play size={16} />다른 상황으로 시험하기</button><button type="button" className={styles.secondary} onClick={onKnowledge}>지식 모음에서 확인</button></div>
      {applied && <button type="button" className={styles.textButton} onClick={() => onContribute(lesson.id)}>공통 지식에 제안<ArrowRight size={16} /></button>}
      <div className={styles.actions}><button type="button" className={styles.textButton} onClick={() => edit({ step: 2 })}>지식 다시 검토</button><button type="button" className={styles.textButton} onClick={() => onChange({ ...practice, lesson: blankLesson() })}><Plus size={15} />다음 사례 가르치기</button></div>
    </section>}
  </>;
}
