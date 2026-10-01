"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Plus, Search, Star } from "lucide-react";
import type { KnowledgeCase, KnowledgeQuestion, Practice } from "@/lib/agent-practice";
import { Empty, Provenance, SectionTitle, TextField, Toggle } from "./practice-ui";
import styles from "./agent-practice.module.css";

export function PracticeKnowledge({ practice, onChange, onTeach, onTest }: { practice: Practice; onChange: (practice: Practice) => void; onTeach: () => void; onTest: (query: string) => void }) {
  const [collection, setCollection] = useState<"cases" | "questions">("cases");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [mobileDetail, setMobileDetail] = useState(false);
  const detail = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!mobileDetail || !window.matchMedia("(max-width: 700px)").matches) return;
    const frame = requestAnimationFrame(() => { detail.current?.scrollIntoView({ block: "start" }); detail.current?.focus({ preventScroll: true }); });
    return () => cancelAnimationFrame(frame);
  }, [mobileDetail, selected]);
  const items = (collection === "cases" ? practice.cases : practice.questions).filter((item) => {
    const content = "title" in item ? `${item.title} ${item.facts} ${item.judgment} ${item.conclusion} ${item.keywords}` : item.prompt;
    return item.origin === "expert" && content.toLocaleLowerCase().includes(search.toLocaleLowerCase()) && (filter === "all" || item.enabled === (filter === "enabled"));
  });
  const currentPage = Math.min(page, Math.max(0, Math.ceil(items.length / 6) - 1));
  const shown = items.slice(currentPage * 6, currentPage * 6 + 6);
  const entry = collection === "cases" ? practice.cases.find((item) => item.id === selected && item.origin === "expert") : undefined;
  const question = collection === "questions" ? practice.questions.find((item) => item.id === selected && item.origin === "expert") : undefined;
  function updateCase(patch: Partial<KnowledgeCase>) { onChange({ ...practice, cases: practice.cases.map((item) => item.id === selected ? { ...item, ...patch } : item) }); }
  function updateQuestion(patch: Partial<KnowledgeQuestion>) { onChange({ ...practice, questions: practice.questions.map((item) => item.id === selected ? { ...item, ...patch } : item) }); }
  function addQuestion() { const id = crypto.randomUUID(); onChange({ ...practice, questions: [...practice.questions, { id, prompt: "새 확인 질문", enabled: true, required: true, origin: "expert" }] }); setSelected(id); setMobileDetail(true); }
  return <>
    <SectionTitle title="나의 지식 모음" description="무엇을 묻고, 어떤 판단을 참고할지 직접 다듬습니다." action={<button className={styles.primary} type="button" onClick={onTeach}><Plus size={16} />사례로 가르치기</button>} />
    <div className={styles.contextNote}><strong>내가 가르친 지식만 모았습니다</strong><p>공통 지식은 플랫폼에서 관리합니다. 직접 검토할 목록에는 포함하지 않으며, 미리보기에서 실제 참고한 출처를 확인할 수 있습니다.</p></div>
    <div className={styles.knowledgeTools}>
      <div className={styles.segmented} aria-label="지식 유형">{(["cases", "questions"] as const).map((type) => <button type="button" key={type} aria-pressed={type === collection} onClick={() => { setCollection(type); setSelected(null); setPage(0); setMobileDetail(false); }}>{type === "cases" ? `답변 사례 ${practice.cases.filter((item) => item.origin === "expert").length}` : `확인 질문 ${practice.questions.filter((item) => item.origin === "expert").length}`}</button>)}</div>
      <label className={styles.search}><Search size={17} /><span className={styles.srOnly}>지식 검색</span><input type="search" placeholder="사례, 판단, 검색어 찾기" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} /></label>
      <select aria-label="지식 사용 상태" value={filter} onChange={(event) => { setFilter(event.target.value); setPage(0); }}><option value="all">전체 지식</option><option value="enabled">사용 중</option><option value="disabled">사용 안 함</option></select>
    </div>
    <div className={styles.library} data-detail={mobileDetail}>
      <section className={styles.libraryList} aria-label="지식 목록">
        <div className={styles.listHead}><span>{items.length}개의 {collection === "cases" ? "답변 사례" : "확인 질문"}</span>{collection === "questions" && <button type="button" className={styles.textButton} disabled={practice.questions.length >= 300} onClick={addQuestion}><Plus size={15} />질문 추가</button>}</div>
        {shown.length ? shown.map((item) => <button type="button" className={styles.knowledgeRow} key={item.id} aria-pressed={selected === item.id} onClick={() => { setSelected(item.id); setMobileDetail(true); }}><span><Provenance sample={item.origin === "sample"} /><strong>{"title" in item ? item.title : item.prompt}</strong><span className={styles.rowMeta}>{item.enabled ? "사용 중" : "사용 안 함"}{"priority" in item && item.priority === "preferred" && <><Star size={12} />우선 참고</>}</span></span><ArrowRight size={17} /></button>) : <Empty title="조건에 맞는 지식이 없습니다">검색어나 사용 상태를 바꿔 보세요. 새 사례를 가르쳐 지식을 추가할 수도 있습니다.</Empty>}
        {items.length > 6 && <div className={styles.pagination}><button type="button" className={styles.secondary} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>이전</button><span>{currentPage + 1} / {Math.ceil(items.length / 6)}</span><button type="button" className={styles.secondary} disabled={(currentPage + 1) * 6 >= items.length} onClick={() => setPage(currentPage + 1)}>다음</button></div>}
      </section>
      <section className={`${styles.paper} ${styles.knowledgeDetail}`} ref={detail} tabIndex={-1} aria-label="지식 편집">
        <button type="button" className={`${styles.textButton} ${styles.mobileBack}`} onClick={() => setMobileDetail(false)}><ArrowLeft size={15} />목록으로</button>
        {entry ? <>
          <div className={styles.panelHead}><h3>답변 사례 다듬기</h3><Provenance sample={entry.origin === "sample"} /></div>
          <div className={styles.form}>
            {![entry.title, entry.facts, entry.judgment, entry.conclusion, entry.keywords].every((value) => value.trim()) && <p role="status" className={styles.error}>사례 이름, 사실, 판단, 결론, 검색어를 모두 채워야 미리보기에서 사용할 수 있습니다.</p>}
            <Toggle label="이 사례 사용" description="사용하지 않는 사례는 미리보기에서 참고하지 않습니다." checked={entry.enabled} onChange={(enabled) => updateCase({ enabled })} />
            <Toggle label="일치하는 사례 중 우선 참고" checked={entry.priority === "preferred"} onChange={(preferred) => updateCase({ priority: preferred ? "preferred" : "standard" })} />
            <TextField label="사례 이름" value={entry.title} onChange={(title) => updateCase({ title })} short maxLength={100} />
            <TextField label="사실 기반" value={entry.facts} onChange={(facts) => updateCase({ facts })} />
            <TextField label="판단" value={entry.judgment} onChange={(judgment) => updateCase({ judgment })} />
            <TextField label="결론" value={entry.conclusion} onChange={(conclusion) => updateCase({ conclusion })} />
            <TextField label="예외" value={entry.exceptions} onChange={(exceptions) => updateCase({ exceptions })} />
            <TextField label="검색어" value={entry.keywords} onChange={(keywords) => updateCase({ keywords })} short maxLength={500} hint="쉼표로 구분합니다. 미리보기는 입력 질문에 포함된 검색어로 사례를 찾습니다." />
            <p className={styles.hint}>연결된 확인 질문 {practice.questions.filter((item) => item.caseId === entry.id).length}개 · 변경 사항은 상단에서 저장하세요.</p>
            <button type="button" className={styles.secondary} onClick={() => onTest(entry.keywords.split(/[,\n]/)[0].trim())}>이 지식으로 시험하기<ArrowRight size={16} /></button>
          </div>
        </> : question ? <>
          <div className={styles.panelHead}><h3>확인 질문 다듬기</h3><Provenance sample={question.origin === "sample"} /></div>
          <div className={styles.form}>
            <TextField label="고객에게 물어볼 질문" value={question.prompt} onChange={(prompt) => updateQuestion({ prompt })} />
            <Toggle label="이 질문 사용" checked={question.enabled} onChange={(enabled) => updateQuestion({ enabled })} />
            <Toggle label="답변 전 필수 확인" description="운영 원칙에서 가져올 때 필수 항목으로 지정합니다." checked={question.required} onChange={(required) => updateQuestion({ required })} />
            <label className={styles.field}>연결할 사례<select value={question.caseId ?? ""} onChange={(event) => updateQuestion({ caseId: event.target.value || undefined })}><option value="">모든 상담에 공통 적용</option>{practice.cases.filter((item) => item.origin === "expert").map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
            <p className={styles.hint}>변경 사항은 상단의 변경 저장으로 보관하세요.</p>
          </div>
        </> : <Empty title="나의 지식을 펼쳐 보세요" action={<BookOpen size={30} strokeWidth={1.4} />}>목록에서 사례나 질문을 선택하면 내용을 확인하고 사용 여부를 정할 수 있습니다.</Empty>}
      </section>
    </div>
  </>;
}
