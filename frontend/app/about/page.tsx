import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ImprintMark } from "@/components/design-system/imprint";
import { ThemeToggle } from "@/components/design-system/theme-toggle";
import { PublicAccountNav } from "@/components/layout/public-account-nav";
import styles from "../entry.module.css";
import { isPrototype } from "@/lib/data-mode";

export const metadata: Metadata = {
  title: "서비스 소개 — 세무 전문가와 함께 만드는 세무상담",
  description: "소상공인·중소사업자의 일상적인 세무 질문에서 실제 세무사와의 상담까지. 세무 전문가와 함께 만드는 서비스의 방향과 현재 체험 범위를 소개합니다.",
};

export default function AboutPage() {
  return <div className={styles.page}>
    <a href="#main" className={styles.skipLink}>본문으로 이동</a>
    <header className={styles.header}>
      <Link href="/" className={styles.brand} aria-label="세무상담 홈"><span className={styles.brandMark}><ImprintMark /></span>세무상담</Link>
      <nav className={styles.navigation} aria-label="서비스 안내"><Link href="/about" aria-current="page">서비스 소개</Link><Link href="/#consultation">질문하기</Link></nav>
      <div className={styles.account}><PublicAccountNav /><ThemeToggle /></div>
    </header>
    <main id="main" tabIndex={-1} className={styles.aboutMain}>
      <section className={styles.aboutHero} aria-labelledby="about-title">
        <h1 id="about-title">사업자의 일상 가까이,<br />세무 전문가와 함께.</h1>
        <p>사업을 하다 생기는 세무 질문, 어디서부터 물어봐야 할지 막막할 때가 있습니다. 세무 용어를 먼저 배우지 않아도, 내 상황을 이야기하는 데서 상담이 시작되도록 만듭니다.</p>
        <Link href="/#consultation" className={styles.primaryAction}>{isPrototype ? "질문하고 체험하기" : "첫 질문 시작하기"} <ArrowRight size={18} aria-hidden="true" /></Link>
        {isPrototype && <span className={styles.actionNote}>현재는 병의원 사례를 활용한 샘플 상담 체험입니다.</span>}
      </section>
      <section className={styles.aboutRow} aria-labelledby="owners-title">
        <h2 id="owners-title">가게를 운영하든,<br />회사를 이끌든.</h2>
        <div><p>소상공인과 중소사업자를 위한 서비스입니다. 차량 비용, 직원 복지, 거래처와의 지출처럼 사업하며 마주치는 질문을 일상의 말로 꺼낼 수 있어야 한다고 생각합니다.</p><p>완벽한 질문을 준비할 필요는 없습니다. 어떤 일이 있었는지, 무엇이 궁금한지부터 이야기해 주세요.</p></div>
      </section>
      <section className={styles.aboutRow} aria-labelledby="professionals-title">
        <h2 id="professionals-title">세무 전문가와<br />함께 만듭니다.</h2>
        <div><p>전문가의 경험과 사업자의 질문이 만나는 서비스를 만듭니다. AI와의 대화에서 끝나는 대신, 실제 세무사와 상담을 이어갈 수 있는 연결을 서비스의 중심에 둡니다.</p><p>전문가가 사례와 상담 지식을 정리하고, 검토하며, 직접 상담에 참여하는 흐름을 함께 만들어 갑니다.</p>{isPrototype && <p className={styles.aboutNote}>현재 체험 화면의 전문가 프로필, 지식 검토와 연결 과정은 샘플입니다. 실제 상담 접수나 전문가의 개별 검토를 제공하는 단계는 아닙니다.</p>}</div>
      </section>
      <section className={styles.aboutRow} aria-labelledby="journey-title">
        <h2 id="journey-title">첫 질문부터,<br />사람과의 상담까지.</h2>
        <ol className={styles.aboutJourney}>
          <li><h3>상황을 이야기합니다</h3><p>어려운 용어 대신 실제로 있었던 일을 적어 주세요. 첫 질문은 로그인 없이 시작할 수 있습니다.</p></li>
          <li><h3>질문과 자료를 정리합니다</h3><p>상황을 이해하는 데 필요한 사실과 확인할 자료를 대화로 짚어 봅니다.</p></li>
          <li><h3>세무사와 상담을 이어갑니다</h3><p>정리한 맥락을 바탕으로 전문가와 직접 이야기하는 흐름입니다. {isPrototype ? "현재는 로그인 후 샘플 상담 신청을 체험합니다." : "상담 신청에는 로그인이 필요합니다."}</p></li>
        </ol>
      </section>
      <section className={styles.aboutDemo} aria-labelledby="demo-title">
        <h2 id="demo-title">{isPrototype ? "지금 체험할 수 있는 것" : "이용 전 확인해 주세요"}</h2>
        <p>{isPrototype ? "병의원 사례를 바탕으로 질문하기, 샘플 응답 확인, 전문가 둘러보기, 상담 신청 흐름을 체험할 수 있습니다. 실제 AI 응답이나 세무 판단, 실제 세무사 연결 및 상담 접수는 제공하지 않습니다." : "AI 안내를 통해 질문과 자료를 정리할 수 있습니다. 개별 사안의 최종 세무 판단은 세무사와 확인해 주세요."}</p>
        <p>대화는 현재 브라우저에 보관됩니다. 다른 기기에서는 불러올 수 없으며, 브라우저 데이터를 지우면 사라집니다. 저장이 차단된 환경에서는 새로고침 후 유지되지 않을 수 있습니다. {isPrototype && "체험에는 실제 개인정보나 민감한 사업 자료 대신 가상의 상황을 사용해 주세요."}</p>
        <Link href="/#consultation" className={styles.primaryAction}>{isPrototype ? "로그인 없이 체험하기" : "로그인 없이 질문하기"} <ArrowRight size={18} aria-hidden="true" /></Link>
      </section>
    </main>
    <footer className={styles.footer}><div><Link href="/" className={styles.brand}><ImprintMark size={26} />세무상담</Link><p>세무 전문가와 함께 만드는 사업자를 위한 서비스.</p></div><p>{isPrototype ? <>샘플 응답으로 상담 흐름을 체험하는 프로토타입입니다.<br />실제 세무 판단이나 상담 접수를 제공하지 않습니다.</> : "최종 세무 판단은 세무사와 확인해 주세요."}</p><Link href="/#consultation">질문하기</Link></footer>
  </div>;
}
