"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { createPolicy, validatePolicy, type PolicyRule } from "@/lib/agent-policy";
import type { Practice } from "@/lib/agent-practice";
import { SectionTitle, TextField, Toggle } from "./practice-ui";
import styles from "./agent-practice.module.css";

export function PracticeRules({ practice, onChange }: { practice: Practice; onChange: (value: Practice) => void }) {
  const rules = practice.rules ?? [];
  const [selected, setSelected] = useState(rules[0]?.id ?? "");
  const rule = rules.find((item) => item.id === selected) ?? rules[0];
  const update = (patch: Partial<PolicyRule>) => onChange({ ...practice, rules: rules.map((item) => item.id === rule?.id ? { ...item, ...patch } : item) });
  function add() { const next = createPolicy(); next.name = "새 상담 기준"; next.keywords = []; onChange({ ...practice, rules: [...rules, next] }); setSelected(next.id); }
  return <section className={styles.ruleSheet}>
    <SectionTitle title="언제 충분히 확인한 걸까요?" description="주제별로 필요한 사실과 AI가 멈출 조건을 직접 정합니다." action={<button type="button" className={styles.secondary} disabled={rules.length >= 30} onClick={add}><Plus size={15} />주제 추가</button>} />
    <p className={styles.hint}>아래 기준은 미리보기에서 바로 시험할 수 있습니다. 별도로 자유롭게 적은 상담 원칙은 아직 자동 해석하지 않습니다.</p>
    <label className={styles.field}>편집할 상담 기준<select value={rule?.id ?? ""} onChange={(event) => setSelected(event.target.value)}>{!rules.length && <option value="">아직 기준이 없습니다</option>}{rules.map((item) => <option key={item.id} value={item.id}>{item.name || "이름 없는 기준"}</option>)}</select></label>
    {rule && <div className={styles.paper}>
      <div className={styles.form}>
        <Toggle label="이 기준 사용" checked={rule.enabled} onChange={(enabled) => update({ enabled })} />
        <TextField short label="기준 이름" value={rule.name} maxLength={100} onChange={(name) => update({ name })} />
        <TextField short label="이 기준을 적용할 검색어" value={rule.keywords.join(",")} maxLength={500} onChange={(value) => update({ keywords: value.split(",").slice(0, 20) })} hint="쉼표로 구분합니다. 검색어는 주제를 찾는 데만 사용하며 사실을 확인한 것으로 처리하지 않습니다." />
        <label className={styles.field}>검색어 적용 방식<select value={rule.match} onChange={(event) => update({ match: event.target.value as PolicyRule["match"] })}><option value="any">하나라도 포함하면</option><option value="all">모두 포함하면</option></select></label>
      </div>
      <section className={styles.ruleSection}>
        <h3>1. 답변 전에 확인할 정보</h3>
        {rule.fields.map((field, index) => <fieldset className={styles.factEditor} key={field.id}><legend>확인 항목 {index + 1}</legend>
          <TextField short label={`항목 ${index + 1} 이름`} value={field.label} maxLength={100} onChange={(label) => update({ fields: rule.fields.map((item) => item.id === field.id ? { ...item, label } : item) })} />
          <TextField short label={`항목 ${index + 1} 확인 질문`} value={field.question} maxLength={1000} onChange={(question) => update({ fields: rule.fields.map((item) => item.id === field.id ? { ...item, question } : item) })} />
          <div className={styles.actions}><Toggle label={`항목 ${index + 1} 필수 확인`} checked={field.required} onChange={(required) => update({ fields: rule.fields.map((item) => item.id === field.id ? { ...item, required } : item) })} /><button className={styles.textButton} type="button" onClick={() => update({ fields: rule.fields.filter((item) => item.id !== field.id), conflicts: { ...rule.conflicts, fieldIds: rule.conflicts.fieldIds.filter((id) => id !== field.id) }, exceptions: rule.exceptions.filter((item) => item.fieldId !== field.id) })}><Trash2 size={14} />항목 {index + 1} 삭제</button></div>
        </fieldset>)}
        <button type="button" className={styles.secondary} disabled={rule.fields.length >= 20} onClick={() => update({ fields: [...rule.fields, { id: crypto.randomUUID(), label: "", question: "", required: true }] })}><Plus size={15} />확인 항목 추가</button>
        {practice.questions.some((item) => item.origin === "expert" && item.enabled) && <label className={styles.field}>내 확인 질문 가져오기<select value="" disabled={rule.fields.length >= 20} onChange={(event) => { const question = practice.questions.find((item) => item.id === event.target.value); if (question) update({ fields: [...rule.fields, { id: crypto.randomUUID(), label: question.prompt.slice(0, 100), question: question.prompt.slice(0, 1000), required: question.required }] }); }}><option value="">질문을 선택해 항목으로 추가</option>{practice.questions.filter((item) => item.origin === "expert" && item.enabled).map((item) => <option key={item.id} value={item.id}>{item.prompt}</option>)}</select><span className={styles.hint}>현재 질문을 복사합니다. 이후 원본 질문을 수정해도 이 기준은 유지됩니다.</span></label>}
      </section>
      <section className={styles.ruleSection}>
        <h3>2. 모르는 사실을 얼마나 되물을까요?</h3>
        <div className={styles.ruleColumns}>
          <label className={styles.field}>최대 재질문 횟수<select value={rule.followUp.maxRounds} onChange={(event) => update({ followUp: { ...rule.followUp, maxRounds: Number(event.target.value) } })}>{[0, 1, 2, 3].map((value) => <option key={value} value={value}>{value}회</option>)}</select></label>
          <label className={styles.field}>횟수 계산 범위<select value={rule.followUp.scope} onChange={(event) => update({ followUp: { ...rule.followUp, scope: event.target.value as "conversation" | "field" } })}><option value="conversation">대화 전체</option><option value="field">확인 항목별</option></select></label>
          <label className={styles.field}>고객이 모른다고 하면<select value={rule.followUp.onUnknown} onChange={(event) => update({ followUp: { ...rule.followUp, onUnknown: event.target.value as "skip" | "human" } })}><option value="skip">그 항목은 다시 묻지 않기</option><option value="human">전문가 참여 권장</option></select></label>
          <Action label="더 묻지 못하는 경우" value={rule.followUp.afterLimit} onChange={(afterLimit) => update({ followUp: { ...rule.followUp, afterLimit } })} />
        </div><p className={styles.hint}>한 번에 여러 항목을 물어도 대화 전체에서는 1회입니다. 모르는 사실은 미확인으로 남고 일반 결론은 보류합니다.</p>
      </section>
      <section className={styles.ruleSection}>
        <h3>3. 어떤 자료가 다를 때 멈출까요?</h3>
        <Toggle label="고객 진술과 제출 자료 비교" checked={rule.conflicts.enabled} onChange={(enabled) => update({ conflicts: { ...rule.conflicts, enabled } })} />
        {rule.conflicts.enabled && <><div className={styles.actions}>{rule.fields.map((field) => <label className={styles.checkLabel} key={field.id}><input type="checkbox" checked={rule.conflicts.fieldIds.includes(field.id)} onChange={(event) => update({ conflicts: { ...rule.conflicts, fieldIds: event.target.checked ? [...rule.conflicts.fieldIds, field.id] : rule.conflicts.fieldIds.filter((id) => id !== field.id) } })} />{field.label || "이름 없는 항목"}</label>)}</div><Action label="같은 항목의 값이 다르면" value={rule.conflicts.action} onChange={(action) => update({ conflicts: { ...rule.conflicts, action } })} /></>}
        <p className={styles.hint}>양쪽 값이 있을 때만 비교합니다. 앞뒤 공백·연속 공백·영문 대소문자를 제외한 문자 비교이며 날짜 형식이나 의미를 해석하지 않습니다.</p>
      </section>
      <section className={styles.ruleSection}>
        <h3>4. 따로 판단할 예외</h3>
        {rule.exceptions.map((item, index) => <fieldset className={styles.factEditor} key={item.id}><legend>예외 {index + 1}</legend><div className={styles.ruleColumns}>
          <label className={styles.field}>판단할 항목<select value={item.fieldId} onChange={(event) => update({ exceptions: rule.exceptions.map((value) => value.id === item.id ? { ...value, fieldId: event.target.value } : value) })}>{rule.fields.map((field) => <option key={field.id} value={field.id}>{field.label || "이름 없는 항목"}</option>)}</select></label>
          <label className={styles.field}>조건<select value={item.operator} onChange={(event) => update({ exceptions: rule.exceptions.map((value) => value.id === item.id ? { ...value, operator: event.target.value as "equals" | "not_equals" | "contains" } : value) })}><option value="equals">같음</option><option value="not_equals">다름</option><option value="contains">포함함</option></select></label>
          <TextField short label={`예외 ${index + 1} 비교 값`} value={item.value} maxLength={500} onChange={(value) => update({ exceptions: rule.exceptions.map((entry) => entry.id === item.id ? { ...entry, value } : entry) })} />
          <Action label={`예외 ${index + 1} 처리`} value={item.action} onChange={(action) => update({ exceptions: rule.exceptions.map((value) => value.id === item.id ? { ...value, action } : value) })} />
        </div><button type="button" className={styles.textButton} onClick={() => update({ exceptions: rule.exceptions.filter((value) => value.id !== item.id) })}><Trash2 size={14} />예외 {index + 1} 삭제</button></fieldset>)}
        <button type="button" className={styles.secondary} disabled={!rule.fields.length || rule.exceptions.length >= 20} onClick={() => update({ exceptions: [...rule.exceptions, { id: crypto.randomUUID(), fieldId: rule.fields[0].id, operator: "equals", value: "", action: "human" }] })}><Plus size={15} />예외 추가</button>
      </section>
      {!!validatePolicy(rule).length && <p role="status" className={styles.error}>{validatePolicy(rule).join(" ")}</p>}
      <button type="button" className={styles.textButton} onClick={() => onChange({ ...practice, rules: rules.filter((item) => item.id !== rule.id) })}><Trash2 size={14} />이 상담 기준 삭제</button>
    </div>}
  </section>;
}
function Action({ label, value, onChange }: { label: string; value: "hold" | "human"; onChange: (value: "hold" | "human") => void }) {
  return <label className={styles.field}>{label}<select value={value} onChange={(event) => onChange(event.target.value as "hold" | "human")}><option value="hold">결론 보류</option><option value="human">전문가 참여 권장</option></select></label>;
}
