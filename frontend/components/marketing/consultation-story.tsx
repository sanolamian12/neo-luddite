"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ArrowDown, ArrowRight, FileText, Paperclip } from "lucide-react";
import { ImprintMark } from "@/components/design-system/imprint";
import styles from "./consultation-story.module.css";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const steps = [
  { label: "질문에서", title: <>사업자의 말로<br />시작하면,</>, body: "세무 용어를 몰라도 괜찮아요. 지금 궁금한 일을 그대로 이야기하세요." },
  { label: "상황을 정리하고", title: <>대화가 쌓여<br />상담의 맥락이 되고,</>, body: "알게 된 사실과 더 확인할 내용을 나누어, 필요한 자료를 짚습니다." },
  { label: "세무사에게", title: <>그 맥락 그대로,<br />세무사와 이어집니다.</>, body: "처음부터 다시 설명하지 않도록. 나의 질문과 정리한 내용을 함께 전합니다." },
];

export function ConsultationStory() {
  const root = useRef<HTMLElement>(null);
  useGSAP(() => {
    const element = root.current;
    if (!element) return;
    const media = gsap.matchMedia();
    media.add("(min-width: 1100px) and (min-height: 720px) and (prefers-reduced-motion: no-preference)", () => {
      element.dataset.enhanced = "true";
      element.dataset.step = "0";
      const followup = element.querySelectorAll("[data-reveal='context']");
      const brief = element.querySelectorAll("[data-reveal='brief']");
      const handoff = element.querySelectorAll("[data-reveal='handoff']");
      gsap.set([followup, brief, handoff], { opacity: 0, y: 14 });
      const timeline = gsap.timeline({ defaults: { ease: "none" }, scrollTrigger: {
        trigger: element, start: "top top", end: "bottom bottom", scrub: 0.25,
        invalidateOnRefresh: true,
        onUpdate: ({ progress }) => { element.dataset.step = progress < 0.26 ? "0" : progress < 0.66 ? "1" : "2"; },
      } });
      timeline.to({}, { duration: 1 })
        .to(followup, { opacity: 1, y: 0, duration: 0.14 }, 0.18)
        .to(brief, { opacity: 1, y: 0, duration: 0.18, stagger: 0.035 }, 0.29)
        .to(handoff, { opacity: 1, y: 0, duration: 0.18 }, 0.64);
      return () => { delete element.dataset.enhanced; delete element.dataset.step; };
    });
    return () => media.revert();
  }, { scope: root });

  return <section ref={root} id="how-it-works" className={styles.story} aria-labelledby="story-title">
    <div className={styles.sticky}>
      <div className={styles.intro}>
        <h2 id="story-title" className={styles.staticTitle}>질문에서 시작해,<br />함께 판단할 준비까지.</h2>
        <div className={styles.copyStack} aria-hidden="true">
          {steps.map((step, index) => <div className={styles.stepCopy} data-copy={index} key={step.label}><h2>{step.title}</h2><p>{step.body}</p></div>)}
        </div>
        <ol className={styles.steps} aria-label="상담 흐름">
          {steps.map((step, index) => <li data-indicator={index} key={step.label}><span>0{index + 1}</span>{step.label}</li>)}
        </ol>
        <p className={styles.scrollHint}><ArrowDown size={14} aria-hidden="true" />스크롤하며 이어지는 과정을 살펴보세요</p>
      </div>
      <div className={styles.record}>
        <div className={styles.recordHeader}><span><ImprintMark size={22} />상담 준비</span><span className={styles.example}>흐름을 보여주는 예시</span></div>
        <div className={styles.recordBody}>
          <div className={styles.conversation}>
            <p className={styles.panelLabel}>01 <span>나의 질문</span></p>
            <p className={styles.question}>리스한 차를 가족도 쓰는데,<br /><strong>비용처리가 될까요?</strong></p>
            <div className={styles.exchange} data-reveal="context">
              <div className={styles.aiQuestion}><span>AI</span><p>업무에는 어떻게 사용하고 계신가요?</p></div>
              <div className={styles.ownerReply}><p>병원 업무와 가족 이동에<br />함께 사용해요.</p></div>
            </div>
            <div className={styles.contextNote} data-reveal="brief"><span className={styles.contextLine} /><span>대화 속 사실이 상담 메모로</span><ArrowRight size={16} aria-hidden="true" /></div>
          </div>
          <div className={styles.brief}>
            <p className={styles.panelLabel}>02 <span>함께 확인할 내용</span><FileText size={17} aria-hidden="true" /></p>
            <h3>차량 비용 상담 메모</h3>
            <dl className={styles.facts}>
              <div data-reveal="brief"><dt>알게 된 사실</dt><dd>업무와 가족 이용이 섞여 있어요.</dd></div>
              <div data-reveal="brief"><dt>더 확인할 점</dt><dd>업무용으로 쓰는 비율은 얼마일까요?</dd></div>
              <div data-reveal="brief"><dt>준비할 자료</dt><dd className={styles.documents}><span><Paperclip size={14} aria-hidden="true" />운행 기록</span><span><Paperclip size={14} aria-hidden="true" />리스 계약서</span></dd></div>
            </dl>
            <p className={styles.briefPlaceholder} aria-hidden="true">대화하며 하나씩 정리됩니다.</p>
          </div>
        </div>
        <div className={styles.handoff} data-reveal="handoff"><span className={styles.handoffNumber}>03</span><div><h3>세무사와 이어갈 질문</h3><p>“이 이용 내역으로, 비용처리 범위를 함께 확인하고 싶어요.”</p></div><ArrowRight size={22} aria-hidden="true" /></div>
        <p className={styles.recordCaption}>병의원 차량 사례로 구성한 예시입니다. 실제 상담 신청이나 세무 판단이 아닙니다.</p>
      </div>
    </div>
  </section>;
}
