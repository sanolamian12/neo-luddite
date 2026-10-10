"use client";

import { useState } from "react";
import { Check, Send } from "lucide-react";
import { contributionKind, contributionStatus, editContribution, reviewContribution, submitContribution, type Contribution, type ContributionActor, type ContributionBoard, type ContributionPayload, type ReviewChecks } from "@/lib/knowledge-contributions";
import { TextField } from "./practice-ui";
import styles from "./agent-practice.module.css";
import css from "./knowledge-growth.module.css";
import type { ContributionWorkingCopy } from "./agent-library";
import { approveAndPublish } from "@/lib/demo/domain";
import { DemoLink, useDemo } from "@/components/demo/runtime";

export function ContributionDetail({ entry, actor, transact, workingCopy, onWorkingCopy }: { entry: Contribution; actor: ContributionActor; transact: (fn: (board: ContributionBoard) => ContributionBoard) => ContributionBoard; workingCopy?: ContributionWorkingCopy; onWorkingCopy?: (copy?: ContributionWorkingCopy) => void }) {
  const demo = useDemo();
  const [payload, setPayload] = useState(workingCopy?.payload ?? entry.payload);
  const [baseVersion, setBaseVersion] = useState(workingCopy?.version ?? entry.version);
  const [privacy, setPrivacy] = useState(false), [permission, setPermission] = useState(false);
  const [checks, setChecks] = useState<ReviewChecks>({ evidence: false, privacy: false, duplicates: false, applicability: false });
  const [note, setNote] = useState("");
  const [issue, setIssue] = useState("");
  const [notice, setNotice] = useState("");
  const reviewer = actor.role === "reviewer";
  const editable = !reviewer && (entry.status === "draft" || entry.status === "changes");
  const dirty = JSON.stringify(payload) !== JSON.stringify(entry.payload);
  const stale = entry.version !== baseVersion;
  const feedback = [...entry.history].reverse().find((event) => ["changes", "declined", "retracted"].includes(event.type));
  function patch(next: Partial<ContributionPayload>) {
    const changed = { ...payload, ...next };
    setPayload(changed); setPrivacy(false); setPermission(false); setNotice("");
    onWorkingCopy?.({ payload: changed, version: baseVersion });
    try {
      const board = transact((current) => editContribution(current, entry.id, actor, changed, baseVersion));
      setBaseVersion(board.entries.find((item) => item.id === entry.id)!.version);
      onWorkingCopy?.(); setIssue("");
    } catch { setIssue("자동 저장하지 못했습니다. 입력은 유지됩니다. 최신 변경 또는 저장 공간을 확인하고 다시 저장해 주세요."); }
  }
  function save(submit = false) {
    try {
      const board = transact((current) => {
        let next = current;
        if (dirty) next = editContribution(next, entry.id, actor, payload, baseVersion);
        return submit ? submitContribution(next, entry.id, actor, { privacy, permission }, baseVersion + (dirty ? 1 : 0)) : next;
      });
      setBaseVersion(board.entries.find((item) => item.id === entry.id)!.version);
      onWorkingCopy?.();
      setIssue(""); setNotice(submit ? "이 브라우저의 검토함에 제출했습니다." : "공유 초안을 이 브라우저에 저장했습니다.");
    } catch (error) { setIssue(error instanceof Error ? error.message : "저장하지 못했습니다. 입력 내용은 유지됩니다."); }
  }
  function review(decision: "publish" | "changes" | "decline" | "retract") {
    try {
      const board = transact((current) => reviewContribution(current, entry.id, actor, demo && decision === "publish" ? "approve" : decision, note, checks, baseVersion));
      setBaseVersion(board.entries.find((item) => item.id === entry.id)!.version);
      setIssue(""); setNotice("검토 결과를 기록했습니다."); setNote("");
    } catch (error) { setIssue(error instanceof Error ? error.message : "검토 결과를 저장하지 못했습니다."); }
  }
  function approve() {
    if (!demo) return;
    try {
      const next = demo.transact(current => approveAndPublish(current, entry.id, baseVersion, note));
      setBaseVersion(next.board.entries.find(item => item.id === entry.id)!.version);
      setIssue(""); setNote(""); setNotice(`공통 지식에 반영했습니다. ${entry.author.name}에게 +1 cr이 기록되었습니다.`);
    } catch (error) { setIssue(error instanceof Error ? error.message : "반영하지 못했습니다. 다시 시도해 주세요."); }
  }
  const shown = editable ? payload : reviewer ? entry.revisions.at(-1)?.payload ?? entry.payload : entry.payload;
  return <article className={css.detail} aria-label="기여 상세">
    <header className={css.detailHeader}><span className={css.status} data-status={entry.status}>{contributionStatus[entry.status]}</span><h3>{entry.payload.title || "새 지식 제안"}</h3><p>{entry.author.name} · {entry.revisions.length ? `제출본 ${entry.revisions.length}` : "아직 제출하지 않은 초안"}</p><small>기여 ID {entry.id}</small></header>
    {issue && <p className={styles.error} role="alert">{issue}</p>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {stale && <div className={styles.error} role="alert">최신 검토 또는 변경이 있습니다. 입력 내용은 유지했습니다.<button type="button" className={styles.textButton} onClick={() => { if (dirty && !window.confirm("저장하지 못한 수정을 버리고 최신 내용을 불러올까요?")) return; setPayload(entry.payload); setBaseVersion(entry.version); onWorkingCopy?.(); setIssue(""); setPrivacy(false); setPermission(false); setChecks({ evidence: false, privacy: false, duplicates: false, applicability: false }); }}>최신 내용 불러오기</button></div>}
    {feedback && <div className={css.feedback}><strong>{feedback.actor.name}님의 검토 의견</strong><p>{feedback.note}</p></div>}
    {demo && reviewer && ["pending", "approved"].includes(entry.status) && <section className={css.quickApproval} aria-label="제안 승인">
      <div><h4>좋은 제안을 모두의 지식으로</h4><p>아래 내용을 확인하고 승인하면 공통 지식과 작성자의 +1 cr에 함께 반영됩니다.</p></div>
      <div className={`${styles.actions} ${css.approvalActions}`}><button type="button" className={styles.primary} disabled={stale || entry.author.id === actor.id} onClick={approve}><Check size={16} />승인하고 반영</button><span>{entry.author.name} · +1 cr</span></div>
      <details><summary>의견 남기기 · 수정 요청</summary><TextField label="검토 의견" value={note} onChange={setNote} hint="승인 의견은 선택 사항입니다. 수정 요청에는 필요한 내용을 적어 주세요." />{entry.status === "pending" && <div className={styles.actions}><button type="button" className={styles.secondary} disabled={stale || !note.trim()} onClick={() => review("changes")}>수정 요청</button><button type="button" className={styles.textButton} disabled={stale || !note.trim()} onClick={() => review("decline")}>미반영</button></div>}</details>
    </section>}
    <div className={css.sheetFields}>
      {editable ? <>
        {demo && <button className={styles.secondary} type="button" onClick={() => patch({ facts: "업무와 개인 사용이 섞인 장비로, 구입 증빙은 있으나 사용 내역을 구분할 기록이 부족한 상황.", sources: "가상 상담에서 검토한 자료 준비 절차. 법령 판단을 포함하지 않는 시연용 제안입니다." })}>예시 공유 문장 넣기</button>}
        <p role="status" className={css.draftStatus}>{dirty ? "아직 저장하지 못한 수정이 있습니다." : "초안 자동 저장됨 · 검토 요청 전에는 제출되지 않습니다."}</p>
        <p className={styles.hint}>공유할 별도 사본입니다. 여기서 바꾼 내용은 내 에이전트의 지식을 변경하지 않습니다. 원문 발화는 첨부되지 않습니다.</p>
        <label className={styles.field}>기여 유형<select value={payload.kind} onChange={(event) => { const kind = event.target.value as ContributionPayload["kind"]; patch({ kind, ...(kind === "question" ? { facts: "", conclusion: "" } : {}) }); }}>{Object.entries(contributionKind).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <TextField label="제안 제목" value={payload.title} onChange={(title) => patch({ title })} short maxLength={100} required />
        {payload.kind !== "question" && <TextField label="공유할 사실 기반" value={payload.facts} onChange={(facts) => patch({ facts })} hint="고객 이름·연락처·식별 가능한 상세 상황을 제거하고 재사용할 조건으로 정리하세요." required />}
        <TextField label="판단 이유" value={payload.judgment} onChange={(judgment) => patch({ judgment })} required />
        {payload.kind !== "question" && <TextField label="제안할 결론" value={payload.conclusion} onChange={(conclusion) => patch({ conclusion })} required />}
        <TextField label="확인 질문" value={payload.questions} onChange={(questions) => patch({ questions })} required={payload.kind === "question"} />
        <TextField label="적용 범위" value={payload.scope} onChange={(scope) => patch({ scope })} hint="어떤 조건, 시점, 분야에서 적용하는지 적어 주세요." required />
        <TextField label="예외와 한계" value={payload.exceptions} onChange={(exceptions) => patch({ exceptions })} />
        <TextField label="검토 가능한 근거" value={payload.sources} onChange={(sources) => patch({ sources })} hint="공개 출처 URL·문서명·해당 문구와 기준일을 적어 주세요. 정정 제안은 대상 지식 ID도 포함하세요. 상담 경험과 공적 근거를 구분해 주세요." required />
        <TextField label="검색어" value={payload.keywords} onChange={(keywords) => patch({ keywords })} short maxLength={500} required />
        <label className={css.check}><input type="checkbox" checked={privacy} onChange={(event) => setPrivacy(event.target.checked)} /><span>개인정보와 고객을 알아볼 수 있는 내용을 제거했습니다.</span></label>
        <label className={css.check}><input type="checkbox" checked={permission} onChange={(event) => setPermission(event.target.checked)} /><span>이 내용을 공통 지식으로 제안할 권한이 있으며, 작성자로 기록되는 데 동의합니다.</span></label>
        <div className={styles.actions}><button type="button" className={styles.primary} disabled={stale || dirty} onClick={() => save(true)}><Send size={16} />{entry.status === "changes" ? "수정해서 다시 제출" : "검토 요청"}</button>{dirty && <button type="button" className={styles.secondary} disabled={stale} onClick={() => save()}>다시 저장</button>}</div>
        <p className={styles.hint}>초안은 이 브라우저에 자동 저장됩니다. 검토 요청은 별도이며, 제출만으로 보상이 발생하지 않습니다.</p>
      </> : <dl className={css.definition}>{[["기여 유형", contributionKind[shown.kind]], ["사실 기반", shown.facts], ["판단 이유", shown.judgment], ["결론", shown.conclusion], ["확인 질문", shown.questions], ["적용 범위", shown.scope], ["예외와 한계", shown.exceptions], ["검토 근거", shown.sources], ["검색어", shown.keywords]].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
    </div>
    {demo && entry.publication && <div className={styles.actions}><DemoLink className={styles.secondary} href={`/audit/ledger?author=${encodeURIComponent(entry.author.id)}`}>{entry.author.name}의 크레딧 확인</DemoLink><DemoLink className={styles.textButton} href="/admin/knowledge-contributions/insights">전체 기여 현황 보기</DemoLink></div>}
    {entry.publication && <section className={css.publication} aria-label="공통 지식 반영 기록"><h4>{entry.status === "retracted" ? "철회된 반영 기록" : "공통 지식 반영 기록"}</h4><p>공통 지식 {entry.publication.id} · 버전 {entry.publication.version}</p><p>작성자 {entry.author.name} · 제출본 {entry.publication.revision}에 연결</p><strong>{entry.credit?.status === "eligible" ? demo ? "+1 cr · 기여 인정" : "보상 검토 대상" : "보상 대상에서 제외됨"}</strong><p className={styles.hint}>기여 인정 기록을 남겼습니다. 지급 기준과 금액은 아직 정해지지 않았으며, 실제 보상은 지급되지 않습니다.</p></section>}
    {reviewer && ((!demo && entry.status === "pending") || entry.status === "published") && <section className={css.reviewActions} aria-label="운영자 검토"><h4>검토 결과 남기기</h4>{demo && <button className={styles.secondary} type="button" onClick={() => setNote("근거와 적용 범위, 개인정보와 중복 여부를 검토했습니다.")}>예시 검토 의견 넣기</button>}{entry.status === "pending" && (Object.entries({ evidence: "근거와 정확성 확인", privacy: "개인정보와 공유 권한 확인", duplicates: "중복·상충 지식 확인", applicability: "적용 범위와 예외 확인" }) as [keyof ReviewChecks, string][]).map(([key, label]) => <label key={key} className={css.check}><input type="checkbox" checked={checks[key]} onChange={(event) => setChecks({ ...checks, [key]: event.target.checked })} /><span>{label}</span></label>)}<TextField label="검토 의견" value={note} onChange={setNote} required /><div className={styles.actions}>{entry.status === "pending" ? <><button className={styles.primary} type="button" disabled={stale} onClick={() => review("publish")}><Check size={16} />{demo ? "검토 완료 · 배치 반영 대기" : "공통 지식에 반영"}</button><button className={styles.secondary} type="button" disabled={stale} onClick={() => review("changes")}>수정 요청</button><button className={styles.textButton} type="button" disabled={stale} onClick={() => review("decline")}>미반영</button></> : <button className={styles.secondary} type="button" disabled={stale} onClick={() => review("retract")}>반영 철회</button>}</div></section>}
    <section className={css.history} aria-label="기여 이력"><h4>작성부터 반영까지</h4><ol>{[...entry.history].reverse().map((event) => <li key={event.id}><strong>{event.note}</strong><span>{event.actor.name} · {new Date(event.at).toLocaleString("ko-KR")}{event.revision > 0 ? ` · 제출본 ${event.revision}` : ""}</span></li>)}</ol>
      {entry.revisions.map((revision) => <details key={revision.number}><summary>제출본 {revision.number} 원본 보기</summary><dl className={css.definition}>{Object.entries({ 제목: revision.payload.title, 사실: revision.payload.facts, 판단: revision.payload.judgment, 결론: revision.payload.conclusion, 질문: revision.payload.questions, 적용범위: revision.payload.scope, 예외: revision.payload.exceptions, 근거: revision.payload.sources }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "—"}</dd></div>)}</dl></details>)}
    </section>
  </article>;
}
