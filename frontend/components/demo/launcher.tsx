"use client";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, MessageCircle, GraduationCap, LibraryBig } from "lucide-react";
import { createDemoRun, scenePath } from "@/lib/demo/domain";
import { loadRun, saveRun } from "@/lib/demo/storage";
import { Button } from "@/components/ui/button";
import css from "./demo.module.css";
import { supportedDemoPath } from "./runtime";
const subscribe = () => () => {};
export function DemoLauncher() {
  const router = useRouter(); const [issue, setIssue] = useState("");
  const last = useSyncExternalStore(subscribe, () => { try { return localStorage.getItem("neo-demo-last-v1") ?? ""; } catch { return ""; } }, () => "");
  function start(resume = false) {
    try { const run = resume ? loadRun(localStorage, last) : saveRun(localStorage, createDemoRun(), null); if (!run) throw new Error("저장된 데모를 찾을 수 없습니다. 새로 시작해 주세요."); localStorage.setItem("neo-demo-last-v1", run.id); router.push(run.lastPath && supportedDemoPath(run.lastPath.split("?")[0]) ? run.lastPath : scenePath(run, run.scene)); }
    catch (cause) { setIssue(cause instanceof Error ? cause.message : "저장소를 확인해 주세요."); }
  }
  return <main className={css.launcher}><h1>하나의 상담이,<br />함께 쓰는 지식이 되기까지.</h1><p>고객의 질문에서 세무사의 직접 상담, 내 AI 가르치기, 공통 지식 반영과 기여 기록까지. 세 가지 시점으로 이어지는 프로토타입 데모입니다.</p>
    <ol className={css.acts}>{[{ icon: MessageCircle, title: "고객과 세무사, 같은 대화에서", body: "공통 AI → 세무사의 AI → 세무사의 직접 답변" }, { icon: GraduationCap, title: "방금 나눈 상담으로 가르치기", body: "상담 전체 또는 필요한 대화를 골라 검토하고, 공유할 지식을 선택합니다." }, { icon: LibraryBig, title: "검토한 기여를 공통 지식으로", body: "제안을 배치로 반영하고 작성자의 크레딧과 출처를 확인합니다." }].map(({ icon: Icon, title, body }) => <li key={title}><Icon size={26} strokeWidth={1.5} /><div><strong>{title}</strong><p>{body}</p></div></li>)}</ol>
    {issue && <p role="alert">{issue}</p>}<div className={css.actions}><Button size="lg" onClick={() => start()}>처음부터 시작<ArrowRight size={18} /></Button>{last && <Button variant="outline" size="lg" onClick={() => start(true)}>이어서 보기</Button>}<Link href="/">서비스 홈</Link></div><p className={css.note}>약 12분 · 가상 상담과 인물 · 이 브라우저에 저장됩니다.<br />실제 모델 실행, RAG 배포, 보상 지급은 하지 않습니다.</p>
  </main>;
}
