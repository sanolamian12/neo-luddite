"use client";

import { type HandoffDemand, REASON_LABEL, rate, sourceLabel } from "@/services/admin-usage";
import { Empty, HBars, fmt, kstTime } from "./usage-charts";

const STATUS_LABEL: Record<string, string> = { pending: "대기", accepted: "수락", declined: "거절", completed: "완료", cancelled: "취소" };

/**
 * 세무사 연결 수요 — 화면 이벤트 퍼널(카드 노출 → 펼침 → 클릭 → 요청, 대화 단위) · 서버 기록 사유별 · 최근 요청.
 * 사유(chat_turns.handoff_reason)는 10/24 부터만 있어 퍼널은 화면 이벤트로 통일했다.
 */
export function HandoffPanel({ data }: { data: HandoffDemand }) {
  const f = data.funnel;
  const empty = f.shown === 0 && f.clicked === 0 && f.requests === 0;
  return (
    <section className="ds-surface" aria-labelledby="handoff-title">
      <h2 id="handoff-title" className="mb-1 text-sm font-medium">세무사 연결 수요</h2>
      <p className="mb-3 text-xs text-muted-foreground">대화 단위. 비회원 클릭은 &quot;로그인하고 연결&quot;을 누른 것 — 그 뒤 로그인에서 이탈해도 수요로 셉니다.</p>
      {empty ? <Empty>이 기간에 세무사 연결 카드가 나온 대화가 없어요.</Empty> : <>
        <HBars label="세무사 연결 퍼널" base={f.shown} items={[
          { key: "shown", label: "카드 노출", value: f.shown, hint: `AI 제안 ${f.shownAi}` },
          { key: "opened", label: "세무사 보기 펼침", value: f.opened },
          { key: "clicked", label: "연결 클릭", value: f.clicked, hint: `회원 ${f.clickedMember} · 비회원 ${f.clickedGuest}` },
          { key: "requests", label: "연결 성립", value: f.requests, hint: `즉시 연결 ${f.requestsInstant}` },
        ]} />
        <p className="mt-2 text-xs text-muted-foreground">
          노출 중 AI 제안 {fmt(f.shownAi)} · 클릭 회원 {fmt(f.clickedMember)} / 비회원 {fmt(f.clickedGuest)} · 즉시 연결 클릭 {fmt(f.clickedInstant)} ·
          성립 중 즉시 연결 {fmt(f.requestsInstant)}
          {Object.keys(data.byStatus).length > 0 && ` · 상태: ${Object.entries(data.byStatus).map(([s, n]) => `${STATUS_LABEL[s] ?? s} ${n}`).join(" · ")}`}
        </p>
      </>}

      <h3 className="mb-2 mt-5 text-xs font-medium text-muted-foreground">카드가 나온 이유 (서버 기록, 10/24 정오부터)</h3>
      {data.byReason.length === 0 ? <p className="text-xs text-muted-foreground">아직 기록이 없어요.</p> : (
        <ul className="flex flex-col gap-1 text-sm">
          {data.byReason.map((r) => {
            const pct = rate(r.clicked, r.conversations);
            return (
              <li key={r.reason} className="flex flex-wrap justify-between gap-2">
                <span>{REASON_LABEL[r.reason] ?? r.reason}</span>
                <span className="tabular-nums text-muted-foreground">대화 {fmt(r.conversations)} → 클릭 {fmt(r.clicked)}{pct !== null && ` (${pct}%)`}</span>
              </li>
            );
          })}
        </ul>
      )}

      <h3 className="mb-2 mt-5 text-xs font-medium text-muted-foreground">최근 연결 요청</h3>
      {data.recent.length === 0 ? <p className="text-xs text-muted-foreground">아직 연결 요청이 없어요.</p> : (
        <ul className="divide-y divide-border text-sm">
          {data.recent.map((r) => (
            <li key={r.id} className="flex flex-wrap gap-x-3 gap-y-0.5 py-2">
              <span className="tabular-nums text-muted-foreground">{kstTime(r.at)}</span>
              <span>{sourceLabel(r.source)}{r.campaign ? ` · ${r.campaign}` : ""}</span>
              <span className="text-muted-foreground">{r.taxTopic ?? "세목 없음"}</span>
              <span>{r.instant ? "즉시 연결" : "신청"} · {STATUS_LABEL[r.status] ?? r.status}</span>
              <span className="text-muted-foreground">{r.expertName ?? "—"}{r.virtualExpert && " · 가상 세무사"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
