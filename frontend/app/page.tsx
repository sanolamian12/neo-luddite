import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowRight } from "lucide-react";
import { ThemeToggle } from "@/components/design-system/theme-toggle";
import { PublicAccountNav } from "@/components/layout/public-account-nav";
import { LandingChat } from "@/components/chat/landing-chat";
import { ConsultationStory } from "@/components/marketing/consultation-story";
import { ImprintMark } from "@/components/design-system/imprint";
import { isPrototype } from "@/lib/data-mode";
import styles from "./entry.module.css";

export const metadata: Metadata = {
  title: "세무상담 — 사업자의 질문에서, 세무사와의 상담까지",
  description: "세무 전문가와 함께 만드는 소상공인·중소사업자를 위한 세무상담. 나의 질문에서 실제 세무사와의 상담까지 이어지는 흐름을 만나 보세요.",
};

export default function Home() {
  return <div className={styles.page}>
    <Link href="#main" className={styles.skipLink}>본문으로 이동</Link>
    <header className={`${styles.header} ${styles.homeHeader}`}>
      <Link href="/" className={styles.brand} aria-label="세무상담 홈"><span className={styles.brandMark}><ImprintMark /></span>세무상담</Link>
      <nav className={styles.navigation} aria-label="서비스 안내"><Link href="/about">서비스 소개</Link></nav>
      <div className={styles.account}><PublicAccountNav /><ThemeToggle /></div>
    </header>
    <main id="main" tabIndex={-1}>
      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.story}>
          <h1 id="hero-title">AI와 시작하고,<br /><span>세무사와 이어가세요.</span></h1>
          <p>세무 전문가와 함께 만드는,<br className={styles.mobileBreak} /> 소상공인·중소사업자를 위한 상담.</p>
        </div>
        <div className={styles.consultationStage}>
          <LandingChat variant="hero" />
        </div>
        <div className={styles.heroFoot}><Link href="#how-it-works">하나의 질문이 상담이 되기까지 <ArrowDown size={16} aria-hidden="true" /></Link></div>
      </section>

      <ConsultationStory />

      <section className={styles.collaboration} aria-labelledby="together-title">
        <h2 id="together-title">세무 전문가와<br />함께 만듭니다.</h2>
        <div className={styles.collaborationCopy}><p>전문가가 사례와 상담 지식을 정리하고 검토하며,<br className={styles.desktopBreak} /> 직접 상담에 참여하는 흐름을 함께 만듭니다.</p><Link href="/about">전문가와 함께 만드는 방식 <ArrowRight size={18} aria-hidden="true" /></Link></div>
      </section>

      <section className={styles.closing} aria-labelledby="closing-title">
        <h2 id="closing-title">이제, 내 질문으로.</h2>
        <Link className={styles.primaryAction} href="#consultation">{isPrototype ? "질문하고 체험하기" : "첫 질문 시작하기"} <ArrowRight size={18} aria-hidden="true" /></Link>
      </section>
    </main>
    <footer className={styles.footer}>
      <div><Link href="/" className={styles.brand}><ImprintMark size={26} />세무상담</Link><p><Link href="/about">서비스 소개 · 이용 안내</Link> · <Link href="/privacy">개인정보처리방침</Link></p></div>
      <p>{isPrototype ? <>병의원 사례 기반 프로토타입입니다.<br />샘플 응답이며 실제 세무 판단·상담 접수를 제공하지 않습니다.</> : "최종 세무 판단은 세무사와 확인해 주세요."}</p>
      <Link href="#main">맨 위로 <ArrowRight size={15} aria-hidden="true" /></Link>
    </footer>
  </div>;
}
