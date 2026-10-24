"use client";

import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CODE_PATTERN, type Campaign, type SourceMetrics, type SourceRow, campaignLink, rate, saveCampaign, sourceLabel } from "@/services/admin-usage";
import { Empty, fmt, kstTime } from "./usage-charts";

type SortKey = "visitors" | "askedRate" | "perSession" | "signups" | "clicked" | "connections";
const COLUMNS: { key: SortKey; label: string; hint: string }[] = [
  { key: "visitors", label: "방문자", hint: "이 경로로 처음 들어온 브라우저 수" },
  { key: "askedRate", label: "질문한 비율", hint: "방문자 중 챗에 한 번이라도 질문한 비율" },
  { key: "perSession", label: "세션당 질문", hint: "채팅 세션(대화) 하나에 질문 몇 개" },
  { key: "signups", label: "가입", hint: "신규 사장님 가입" },
  { key: "clicked", label: "연결 클릭", hint: "세무사 연결 버튼을 누른 방문자" },
  { key: "connections", label: "연결 성립", hint: "상담 신청·즉시 연결" },
];

const sortValue = (m: SourceMetrics, k: SortKey) =>
  k === "askedRate" ? (m.visitors ? m.asked / m.visitors : 0) : k === "perSession" ? (m.sessions ? m.questions / m.sessions : 0) : m[k];

function Cells({ m }: { m: SourceMetrics }) {
  const asked = rate(m.asked, m.visitors);
  return <>
    <td className="tabular-nums">{fmt(m.visitors)}</td>
    <td className="tabular-nums">{asked === null ? "—" : `${asked}%`} <small className="text-muted-foreground">({m.asked})</small></td>
    <td className="tabular-nums">{m.sessions ? (m.questions / m.sessions).toFixed(1) : "—"}</td>
    <td className="tabular-nums">{fmt(m.signups)}</td>
    <td className="tabular-nums">{fmt(m.clicked)}</td>
    <td className="tabular-nums">{fmt(m.connections)}</td>
  </>;
}

/** 유입 경로 표(핵심) — 경로별 방문 → 질문 → 가입 → 연결. 열 머리를 누르면 정렬, 경로를 누르면 게시글(campaign)별로 펼친다. */
export function SourceTable({ sources, onFilter }: { sources: SourceRow[]; onFilter: (source: string) => void }) {
  const [sort, setSort] = useState<SortKey>("visitors");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const rows = [...sources].sort((a, b) => sortValue(b, sort) - sortValue(a, sort) || a.source.localeCompare(b.source));
  const toggle = (s: string) => setOpen((prev) => { const next = new Set(prev); if (next.has(s)) next.delete(s); else next.add(s); return next; });

  return (
    <section className="ds-surface" aria-labelledby="sources-title">
      <h2 id="sources-title" className="mb-1 text-sm font-medium">유입 경로</h2>
      <p className="mb-3 text-xs text-muted-foreground">경로 = 방문자가 처음 들어온 링크(게시 코드 → utm → 직전 사이트 → 직접 방문 순). 가입·연결도 그 첫 경로로 셉니다.</p>
      {rows.length === 0 ? <Empty>이 기간에 방문 기록이 없어요. 게시 링크를 올리면 여기에 경로별로 나타납니다.</Empty> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm [&_td]:py-1.5 [&_td]:pr-3 [&_th]:pb-2 [&_th]:pr-3 [&_th]:font-medium">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th>경로</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} title={c.hint} aria-sort={sort === c.key ? "descending" : "none"}>
                    <button type="button" className={sort === c.key ? "text-foreground underline underline-offset-4" : ""} onClick={() => setSort(c.key)}>{c.label}</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <Fragment key={r.source}>
                  <tr>
                    <td className="max-w-[14rem]">
                      <div className="flex items-center gap-1.5">
                        {r.campaigns.length > 0
                          ? <button type="button" aria-expanded={open.has(r.source)} className="w-4 text-muted-foreground" onClick={() => toggle(r.source)} aria-label={`${sourceLabel(r.source)} 게시글별 펼치기`}>{open.has(r.source) ? "▾" : "▸"}</button>
                          : <span className="w-4" />}
                        <button type="button" className="truncate text-left hover:underline" title="이 경로만 보기" onClick={() => onFilter(r.source)}>{sourceLabel(r.source)}</button>
                      </div>
                    </td>
                    <Cells m={r} />
                  </tr>
                  {open.has(r.source) && r.campaigns.map((c) => (
                    <tr key={`${r.source}:${c.campaign}`} className="text-muted-foreground">
                      <td className="truncate pl-6 text-xs">└ {c.campaign}</td>
                      <Cells m={c} />
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** 게시 코드 — /r/<코드> 링크를 만들어 커뮤니티 글에 붙인다. 코드를 나중에 등록해도 지난 방문이 그 경로로 잡힌다. */
export function CampaignPanel({ campaigns, onSaved }: { campaigns: Campaign[] | null; onSaved: () => void }) {
  const [code, setCode] = useState("");
  const [source, setSource] = useState("");
  const [campaign, setCampaign] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const valid = CODE_PATTERN.test(code) && CODE_PATTERN.test(source);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      await saveCampaign({ code, source, campaign: campaign.trim() || undefined, label: label.trim() || undefined });
      setMessage({ ok: true, text: `저장했어요. 게시 링크: ${campaignLink(origin, code)}` });
      setCode(""); setCampaign(""); setLabel("");
      onSaved();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "저장하지 못했어요." });
    } finally { setBusy(false); }
  };
  const copy = async (c: string) => {
    try { await navigator.clipboard.writeText(campaignLink(origin, c)); setCopied(c); setTimeout(() => setCopied(null), 1500); } catch { /* 복사 불가 브라우저 */ }
  };

  return (
    <section className="ds-surface" aria-labelledby="campaigns-title">
      <h2 id="campaigns-title" className="mb-1 text-sm font-medium">게시 코드</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        커뮤니티 글에 <code>/r/코드</code> 링크를 붙이면 그 글로 들어온 방문을 따로 셉니다. 채널 예: <code>apsa</code>(아프니까 사장이다) · <code>kyungrinara</code>(경리나라). 같은 코드로 다시 저장하면 고쳐집니다.
      </p>
      <form onSubmit={submit} className="grid gap-2 sm:grid-cols-[8rem_9rem_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <label className="flex flex-col gap-1 text-xs">코드
          <Input value={code} onChange={(e) => setCode(e.target.value.toLowerCase())} placeholder="apsa1" maxLength={40} aria-invalid={code !== "" && !CODE_PATTERN.test(code)} />
        </label>
        <label className="flex flex-col gap-1 text-xs">채널
          <Input value={source} onChange={(e) => setSource(e.target.value.toLowerCase())} placeholder="apsa" maxLength={40} list="nl-source-codes" aria-invalid={source !== "" && !CODE_PATTERN.test(source)} />
          <datalist id="nl-source-codes"><option value="apsa" /><option value="kyungrinara" /></datalist>
        </label>
        <label className="flex flex-col gap-1 text-xs">글 이름
          <Input value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="10월 첫 소개글" maxLength={80} />
        </label>
        <label className="flex flex-col gap-1 text-xs">메모(선택)
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="자유게시판" maxLength={120} />
        </label>
        <Button type="submit" size="sm" disabled={!valid || busy}>{busy ? "저장 중…" : "저장"}</Button>
      </form>
      {message && <p role={message.ok ? "status" : "alert"} className={`mt-2 break-all text-xs ${message.ok ? "text-muted-foreground" : "text-destructive"}`}>{message.text}</p>}
      <div className="mt-4">
        {campaigns === null ? <p role="status" className="text-xs text-muted-foreground">불러오는 중…</p>
          : campaigns.length === 0 ? <Empty>아직 등록한 게시 코드가 없어요. 위에서 하나 만들고 링크를 글에 붙여 보세요.</Empty>
          : (
            <ul className="divide-y divide-border text-sm">
              {campaigns.map((c) => (
                <li key={c.code} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <code className="font-medium">{c.code}</code>
                  <span>{sourceLabel(c.source)}{c.campaign ? ` · ${c.campaign}` : ""}</span>
                  {c.label && <span className="text-xs text-muted-foreground">{c.label}</span>}
                  <span className="text-xs text-muted-foreground">방문자 {fmt(c.visitors)} · {kstTime(c.createdAt)} 등록</span>
                  <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => void copy(c.code)}>
                    {copied === c.code ? "복사됨" : "링크 복사"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
      </div>
    </section>
  );
}
