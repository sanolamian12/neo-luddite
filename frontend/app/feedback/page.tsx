import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Mail } from "lucide-react";
import { ImprintMark } from "@/components/design-system/imprint";
import { ThemeToggle } from "@/components/design-system/theme-toggle";
import { PublicAccountNav } from "@/components/layout/public-account-nav";
import { FeedbackAddress } from "@/components/marketing/feedback-address";
import { FEEDBACK_MAILTO } from "@/lib/feedback-contact";
import entry from "../entry.module.css";
import styles from "./feedback.module.css";

export const metadata: Metadata = {
  title: "사용 의견 보내기 — Credigraph",
  description: "Credigraph를 사용하며 도움이 된 점, 불편한 점, 바라는 점을 이메일로 알려주세요.",
};

export default function FeedbackPage() {
  return <div className={entry.page}>
    <a href="#main" className={entry.skipLink}>본문으로 이동</a>
    <header className={entry.header}>
      <Link href="/" className={entry.brand} aria-label="Credigraph 홈"><span className={entry.brandMark}><ImprintMark /></span>Credigraph</Link>
      <nav className={entry.navigation} aria-label="서비스 안내"><Link href="/about">서비스 소개</Link><Link href="/feedback" aria-current="page">사용 의견</Link><Link href="/#consultation">질문하기</Link></nav>
      <div className={entry.account}><PublicAccountNav /><ThemeToggle /></div>
    </header>
    <main id="main" tabIndex={-1} className={`${entry.aboutMain} ${styles.main}`}>
      <section className={styles.intro} aria-labelledby="feedback-title">
        <h1 id="feedback-title">사용해 보니 어떠셨나요?</h1>
        <p>도움이 된 순간도, 막혔던 순간도 알려주세요.<br />보내주신 의견은 Credigraph를 다듬는 데 참고하겠습니다.</p>
      </section>
      <section className={styles.feedbackRow} aria-labelledby="feedback-action-title">
        <div className={styles.prompts}>
          <h2>한 가지만 알려주셔도 좋아요.</h2>
          <ul><li>어떤 기능을 사용해 보셨나요?</li><li>도움이 되었거나 불편했던 점은 무엇인가요?</li><li>어떻게 바뀌면 더 쓰기 편할까요?</li></ul>
          <p>개인정보나 민감한 사업 자료는 빼고 적어주세요. 대화 내용은 이메일에 자동으로 첨부되지 않습니다.</p>
        </div>
        <div className={styles.contact}>
          <h2 id="feedback-action-title">이메일로 의견 보내기</h2>
          <p className={styles.mailHint} id="feedback-mail-hint">기기의 이메일 앱에서 초안을 엽니다. 내용을 확인한 뒤 직접 보내주세요.</p>
          <a href={FEEDBACK_MAILTO} className={entry.primaryAction} aria-describedby="feedback-mail-hint"><Mail size={18} aria-hidden="true" />이메일 작성하기</a>
          <FeedbackAddress />
        </div>
      </section>
      <aside className={styles.consultation} aria-labelledby="tax-question-title">
        <div><h2 id="tax-question-title">세무 질문이 있으신가요?</h2><p>이 이메일은 제품 사용 의견을 받는 창구입니다. 세무 질문은 질문하기 화면에서 시작해 주세요.</p></div>
        <Link href="/#consultation">질문하기로 이동 <ArrowRight size={16} aria-hidden="true" /></Link>
      </aside>
    </main>
    <footer className={entry.footer}>
      <div><Link href="/" className={entry.brand}><ImprintMark size={26} />Credigraph</Link><p><Link href="/about">서비스 소개 · 이용 안내</Link> · <Link href="/privacy">개인정보처리방침</Link></p></div>
      <Link href="/">홈으로 돌아가기</Link>
    </footer>
  </div>;
}
