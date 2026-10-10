import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PublicHeader } from "@/components/layout/public-header";
import { LandingChat } from "@/components/chat/landing-chat";
import { ImprintContours } from "@/components/design-system/imprint";
import styles from "./entry.module.css";
import { isPrototype } from "@/lib/data-mode";

export default function Home() {
  return <>
    <PublicHeader />
    <main className={styles.landing}>
      <section className={styles.story}>
        <h1>세무 용어를 <br />몰라도,<br /><span>상황부터 이야기해 주세요.</span></h1>
        <p>“이것도 비용이 될까?” 싶은 순간.<br />질문을 함께 정리하고, 필요한 순간에는<br className={styles.desktopBreak} /> 전문가와 대화를 이어가세요.</p>
        <ImprintContours className={styles.imprint} reveal />
        <div className={styles.journey} aria-label="상담 흐름"><span>나의 상황</span><ArrowRight size={16} /><span>함께 정리</span><ArrowRight size={16} /><span>전문가 연결</span></div>
      </section>
      <div className={styles.chat}><LandingChat /></div>
      <footer className={styles.footer}><span>첫 질문에는, 준비가 필요 없으니까.</span><span>{isPrototype ? "병의원 상담 흐름을 체험하는 프로토타입" : "병의원 세무 상담"} · <Link href="/privacy" className="underline underline-offset-4">개인정보처리방침</Link></span></footer>
    </main>
  </>;
}
