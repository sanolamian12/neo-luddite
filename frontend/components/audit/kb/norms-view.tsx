"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Clock,
  FilePlus2,
  History,
  Megaphone,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  ScrollText,
  ShieldAlert,
  ThumbsUp,
  Trash2,
  Undo2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/poc-format";
import { useAccountStore } from "@/lib/account-store";
import { useNormsPendingStore } from "@/lib/norms-pending";
import * as normsService from "@/services/norms";
import type { NormDocument, NormName, NormsOverview, NormVersion } from "@/services/norms";

/**
 * AI 상담 규범(L0) 검토·편집 — KB통합 3층검색 로드맵 P5 (2026-09-17).
 *
 * 규범 3종은 검색되지 않고 **모든 답변의 시스템 프롬프트에 상시 주입**된다. 그래서 저장 한 번이
 * 곧 전역 변경이라 거버넌스를 둔다(P6 ②, 2026-09-17):
 *   초안  — admin·세무사 누구나 작성·수정·폐기. 답변에 영향 없음. 문서당 1개.
 *   공개  — 이의 기간(1일) 시작. 세무사가 승인·이의를 남긴다.
 *   반영  — 작성자·공개자 제외 세무사 승인이 문턱(fastApprovals) 이상이고 이의 0 → 즉시.
 *           아무도 막지 않으면 기한 뒤 자동(침묵 = 동의). 이의가 있으면 철회·수정 전까지 보류.
 * 공개 중에 수정하면 초안으로 돌아가고 승인·이의는 초기화된다(다시 공개).
 * 되돌리기는 과거 확정본으로 새 초안을 만들어 같은 길을 지난다.
 *
 * 승인·이의는 mode="auditor"(/audit/norms)에서만. 신원·역할 판정은 백엔드가 토큰으로 한다(화면 게이팅은 편의).
 *
 * 이 화면은 백엔드 규범만 편집한다 — /audit/knowledge 해설 시드와는 다른 문서다.
 */

type Mode = "auditor" | "admin";

// 412px 에서 탭 3개가 한 줄에 들어가게 짧은 이름. 전체 제목은 확정 다이얼로그에 쓴다.
const TAB_LABEL: Record<NormName, string> = {
  master: "답변 절차",
  frameworks: "해석 원칙",
  pitfalls: "오류 패턴",
};

// ── 줄 단위 diff (LCS) — 규범은 문서당 수십 줄이라 O(n·m) 로 충분 ─────────────────────
type DiffLine = { kind: "same" | "add" | "del"; text: string };

function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: "del", text: a[i++] });
    } else {
      out.push({ kind: "add", text: b[j++] });
    }
  }
  while (i < a.length) out.push({ kind: "del", text: a[i++] });
  while (j < b.length) out.push({ kind: "add", text: b[j++] });
  return out;
}

function DiffView({ before, after }: { before: string; after: string }) {
  const lines = useMemo(() => diffLines(before.trim(), after.trim()), [before, after]);
  const changed = lines.some((l) => l.kind !== "same");
  if (!changed) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">확정본과 내용이 같습니다.</p>;
  }
  return (
    <pre className="overflow-x-auto px-0 py-2 font-mono text-xs leading-relaxed">
      {lines.map((l, idx) => (
        <div
          key={idx}
          className={cn(
            "px-3 whitespace-pre-wrap break-words",
            l.kind === "add" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
            l.kind === "del" && "bg-destructive/10 text-destructive line-through",
          )}
        >
          <span className="mr-2 select-none opacity-60">
            {l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}
          </span>
          {l.text || " "}
        </div>
      ))}
    </pre>
  );
}

function versionLabel(v: NormVersion | undefined): string {
  if (!v) return "확정본 없음";
  return v.versionNo ? `v${v.versionNo}` : "초안";
}

const APPLIED_VIA: Record<string, string> = {
  direct: "1인 확정(구 방식)",
  approvals: "승인 문턱",
  deadline: "이의 기간 만료",
};

export function remainingLabel(deadlineAt: number | undefined, now = Date.now()): string {
  if (!deadlineAt) return "";
  const ms = deadlineAt - now;
  if (ms <= 0) return "기한 지남 — 이의가 없으면 곧 반영";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}시간 ${m}분 남음` : `${m}분 남음`;
}

// ── 공개 중 제안 ─────────────────────────────────────────────────────────────────
function PendingProposal({
  proposal,
  active,
  overview,
  mode,
  userId,
  busy,
  onEdit,
  run,
}: {
  proposal: NormVersion;
  active: NormVersion | undefined;
  overview: NormsOverview;
  mode: Mode;
  userId: string;
  busy: boolean;
  onEdit: () => void;
  run: (fn: () => Promise<normsService.NormVersionResult>) => Promise<boolean>;
}) {
  const [objecting, setObjecting] = useState(false);
  const [reason, setReason] = useState("");
  const [withdrawArmed, setWithdrawArmed] = useState(false);
  const mine = proposal.decisions.find((d) => d.auditorId === userId);
  const isOwner = proposal.authorId === userId || proposal.publishedBy === userId;
  const held = proposal.objections > 0;

  const decide = (decision: normsService.NormDecisionKind) =>
    run(() =>
      normsService.decide(proposal.id, {
        decision,
        reason: decision === "object" ? reason.trim() : undefined,
        expectedUpdatedAt: proposal.updatedAt,
      }),
    ).then((ok) => {
      if (ok) {
        setObjecting(false);
        setReason("");
      }
    });

  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border bg-card",
        held ? "border-destructive/40" : "border-sky-500/40",
      )}
      aria-label="공개 중인 제안"
    >
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
        <Badge variant={held ? "destructive" : "secondary"}>{held ? "이의로 보류" : "공개 중"}</Badge>
        <span>작성 {proposal.authorId}</span>
        <span>· 공개 {proposal.publishedBy} {formatDateTime(proposal.publishedAt)}</span>
        <span className="ml-auto flex items-center gap-1 font-medium text-foreground">
          <Clock className="size-3.5" />
          {remainingLabel(proposal.deadlineAt)}
        </span>
      </header>
      <div className="flex flex-col gap-2 border-b px-4 py-2.5 text-sm">
        <p className="break-words">
          <span className="text-muted-foreground">변경 사유 · </span>
          {proposal.note}
        </p>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="flex items-center gap-1">
            <ThumbsUp className="size-3.5 text-brand-green" />
            승인 {proposal.approvals} / {overview.fastApprovals}
          </span>
          <span className={cn("flex items-center gap-1", held && "font-semibold text-destructive")}>
            <ShieldAlert className="size-3.5" />
            이의 {proposal.objections}
          </span>
          <span className="text-muted-foreground">
            {held
              ? "이의가 철회되거나 제안이 수정될 때까지 반영되지 않습니다"
              : `승인 ${overview.fastApprovals}명이면 즉시, 아니면 기한 뒤 자동 반영`}
          </span>
        </div>
        {proposal.decisions.length > 0 && (
          <ul className="flex flex-col gap-1 text-xs">
            {proposal.decisions.map((d) => (
              <li key={d.auditorId} className="flex flex-wrap gap-1.5">
                <Badge variant={d.decision === "object" ? "destructive" : "outline"}>
                  {d.decision === "object" ? "이의" : "승인"}
                </Badge>
                <span className="font-medium">{d.auditorId}</span>
                <span className="text-muted-foreground">{formatDateTime(d.createdAt)}</span>
                {d.reason && <span className="min-w-0 break-words">— {d.reason}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="min-w-0">
        <p className="border-b px-3 py-1.5 text-xs font-medium text-muted-foreground">확정본 대비 변경</p>
        <DiffView before={active?.content ?? ""} after={proposal.content} />
      </div>
      {objecting && (
        <div className="flex flex-col gap-2 border-t px-4 py-2.5">
          <label className="text-xs font-medium text-muted-foreground" htmlFor={`norm-object-${proposal.id}`}>
            이의 사유 (필수 — 작성자가 보고 수정합니다)
          </label>
          <input
            id={`norm-object-${proposal.id}`}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      )}
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-2.5">
        <Button size="sm" variant="ghost" disabled={busy} onClick={onEdit} title="수정하면 승인·이의가 초기화되고 다시 공개해야 합니다">
          <Pencil className="size-3.5" />
          수정
        </Button>
        {isOwner && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              if (!withdrawArmed) return setWithdrawArmed(true);
              void run(() => normsService.discardDraft(proposal.id, userId));
            }}
          >
            <Trash2 className="size-3.5" />
            {withdrawArmed ? "정말 거둬들이기" : "제안 거둬들이기"}
          </Button>
        )}
        {mode === "auditor" && mine && (
          <>
            <span className="text-xs text-muted-foreground">
              내 결정: {mine.decision === "object" ? "이의" : "승인"}
            </span>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => normsService.withdrawDecision(proposal.id))}>
              <Undo2 className="size-3.5" />
              {mine.decision === "object" ? "이의 철회" : "승인 철회"}
            </Button>
          </>
        )}
        {mode === "auditor" && !isOwner && mine?.decision !== "object" &&
          (objecting ? (
            <>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setObjecting(false)}>
                취소
              </Button>
              <Button size="sm" variant="destructive" disabled={busy || reason.trim().length === 0} onClick={() => void decide("object")}>
                <ShieldAlert className="size-3.5" />
                이의 제출
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setObjecting(true)}>
              <ShieldAlert className="size-3.5" />
              이의
            </Button>
          ))}
        {mode === "auditor" && !isOwner && mine?.decision !== "approve" && !objecting && (
          <Button size="sm" disabled={busy} onClick={() => void decide("approve")}>
            <ThumbsUp className="size-3.5" />
            승인
          </Button>
        )}
        {mode === "auditor" && isOwner && (
          <span className="text-xs text-muted-foreground">내 제안 — 다른 세무사의 승인을 기다립니다</span>
        )}
        {mode === "admin" && <span className="text-xs text-muted-foreground">승인·이의는 세무사 계정에서 합니다</span>}
      </footer>
    </section>
  );
}

// ── 문서 패널 ───────────────────────────────────────────────────────────────────
function NormDocumentPanel({
  doc,
  overview,
  mode,
  userId,
  onChanged,
}: {
  doc: NormDocument;
  overview: NormsOverview;
  mode: Mode;
  userId: string;
  onChanged: () => Promise<void>;
}) {
  const draft = doc.draft;
  const active = doc.active;
  const pending = draft?.status === "pending" ? draft : undefined;
  // 편집 버퍼. 초안이 있으면 그 내용, 없으면 null(읽기 모드) — "초안 만들기" 로 확정본을 복사해 연다.
  // 공개 중 제안은 읽기(승인·이의)로 시작하고, "수정"을 눌러야 버퍼가 열린다.
  const [text, setText] = useState<string | null>(draft && !pending ? draft.content : null);
  const [note, setNote] = useState(draft?.note ?? "");
  const [baseVersionId, setBaseVersionId] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [discardArmed, setDiscardArmed] = useState(false);
  const [history, setHistory] = useState<NormVersion[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const dirty = text !== null && (!draft || text !== draft.content || note !== (draft.note ?? ""));

  // 예산 미리보기 — 이 문서만 편집 버퍼로 바꾼 주입 블록 길이.
  const projected = useMemo(() => {
    const contents = overview.documents.map((d) =>
      d.name === doc.name ? (text ?? d.active?.content ?? "") : (d.active?.content ?? ""),
    );
    return normsService.injectedLength(contents);
  }, [overview.documents, doc.name, text]);
  const overBudget = projected > overview.maxChars;
  const empty = text !== null && text.trim().length === 0;

  const loadHistory = async () => {
    try {
      setHistory(await normsService.listVersions(doc.name));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const run = async (fn: () => Promise<normsService.NormVersionResult>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "요청이 거절됐습니다");
        return false;
      }
      await onChanged();
      if (historyOpen) await loadHistory();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(() =>
      normsService.saveDraft(doc.name, {
        content: text ?? "",
        editorId: userId,
        note: note.trim() || undefined,
        expectedUpdatedAt: draft?.updatedAt,
        baseVersionId: draft ? undefined : baseVersionId,
      }),
    );

  const discard = () => {
    if (pending) {
      // 공개 중 제안의 수정 버퍼만 닫는다 — 제안 자체는 그대로 공개 중.
      setText(null);
      setNote(pending.note ?? "");
      return;
    }
    if (!draft) {
      // 아직 저장 안 한 새 초안 — 버퍼만 닫는다.
      setText(null);
      setNote("");
      setBaseVersionId(undefined);
      return;
    }
    if (!discardArmed) {
      setDiscardArmed(true);
      return;
    }
    void run(() => normsService.discardDraft(draft.id, userId));
  };

  const publish = async () => {
    if (!draft) return;
    const ok = await run(() =>
      normsService.publishDraft(draft.id, {
        expectedUpdatedAt: draft.updatedAt,
        note: note.trim() || undefined,
      }),
    );
    if (ok) setConfirmOpen(false);
  };
  const periodHours = Math.round(overview.objectionPeriodSec / 3600);

  const startDraftFrom = (content: string, fromVersion?: NormVersion) => {
    setText(content);
    setNote(fromVersion ? `${versionLabel(fromVersion)}로 되돌리기 — ` : "");
    setBaseVersionId(fromVersion?.id);
    setError(null);
  };

  const sameAsActive = draft !== undefined && active !== undefined && draft.content.trim() === active.content.trim();

  return (
    <div className="flex flex-col gap-4">
      {/* 확정본 메타 */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">현재 확정 {versionLabel(active)}</Badge>
        {active?.confirmedBy && <span>반영 {active.confirmedBy}</span>}
        {active?.appliedVia && <span>({APPLIED_VIA[active.appliedVia] ?? active.appliedVia})</span>}
        {active?.confirmedAt && <span>{formatDateTime(active.confirmedAt)}</span>}
        {active?.note && <span className="min-w-0 break-words">· {active.note}</span>}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {text === null && pending ? (
        <PendingProposal
          proposal={pending}
          active={active}
          overview={overview}
          mode={mode}
          userId={userId}
          busy={busy}
          run={run}
          onEdit={() => {
            setText(pending.content);
            setNote(pending.note ?? "");
            setError(null);
          }}
        />
      ) : text === null ? (
        // ── 읽기 모드: 확정본 ─────────────────────────────────────────────────────
        <section className="overflow-hidden rounded-xl border bg-card">
          <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
            <span className="text-sm font-medium">확정본 — 지금 답변에 들어가는 내용</span>
            <Button
              size="sm"
              className="ml-auto"
              disabled={!active}
              onClick={() => active && startDraftFrom(active.content)}
            >
              <FilePlus2 className="size-3.5" />
              초안 만들기
            </Button>
          </header>
          <pre className="overflow-x-auto px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
            {active?.content ?? "확정본이 없습니다."}
          </pre>
        </section>
      ) : (
        // ── 편집 모드: 초안 ───────────────────────────────────────────────────────
        <section className="overflow-hidden rounded-xl border border-brand-amber/40 bg-card">
          <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
            <Badge variant="secondary">{pending ? "공개 중 제안 수정" : "초안"}</Badge>
            {pending && (
              <span className="text-destructive">저장하면 승인·이의가 초기화되고 초안으로 돌아갑니다(다시 공개 필요)</span>
            )}
            {draft ? (
              <>
                <span>작성 {draft.authorId}</span>
                <span>· 마지막 수정 {draft.updatedBy} {formatDateTime(draft.updatedAt)}</span>
              </>
            ) : (
              <span>아직 저장 안 됨{baseVersionId ? " · 과거 확정본에서 되돌리기" : ""}</span>
            )}
            {dirty && <span className="text-brand-amber">· 저장 안 한 변경</span>}
            <span className={cn("ml-auto font-mono", overBudget && "font-semibold text-destructive")}>
              주입 {projected.toLocaleString()} / {overview.maxChars.toLocaleString()}자
            </span>
          </header>
          <div className="grid grid-cols-1 divide-y md:grid-cols-2 md:divide-x md:divide-y-0">
            <div className="flex flex-col gap-2 p-3">
              <textarea
                className="min-h-[320px] w-full rounded-md border bg-background p-2 font-mono text-xs leading-relaxed"
                value={text}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
                aria-label={`${doc.title} 초안`}
              />
              <input
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="변경 사유 · 항목 번호 (예: P-2 가사관련비 경고 추가) — 공개 시 필수"
              />
            </div>
            <div className="min-w-0">
              <p className="border-b px-3 py-1.5 text-xs font-medium text-muted-foreground">확정본 대비 변경</p>
              <DiffView before={active?.content ?? ""} after={text} />
            </div>
          </div>
          {overBudget && (
            <p className="border-t px-4 py-2 text-xs text-destructive">
              예산 초과 — 세 문서 합계가 {overview.maxChars.toLocaleString()}자를 넘으면 규범 전체가 빠진 채로
              답변이 나갑니다. 저장할 수 없습니다. 규범을 줄여 주세요.
            </p>
          )}
          <footer className="flex flex-wrap justify-end gap-2 border-t px-4 py-2.5">
            <Button size="sm" variant="outline" disabled={busy} onClick={discard}>
              <Trash2 className="size-3.5" />
              {!draft || pending ? "닫기" : discardArmed ? "정말 폐기" : "초안 폐기"}
            </Button>
            <Button size="sm" variant="outline" disabled={busy || !dirty || overBudget || empty} onClick={() => void save()}>
              <Save className="size-3.5" />
              {pending ? "수정 저장(초안으로)" : "초안 저장"}
            </Button>
            {!pending && (
              <Button
                size="sm"
                disabled={busy || !draft || dirty || overBudget || sameAsActive}
                onClick={() => {
                  setError(null);
                  setConfirmOpen(true);
                }}
                title={dirty ? "먼저 초안을 저장하세요" : sameAsActive ? "확정본과 내용이 같습니다" : undefined}
              >
                <Megaphone className="size-3.5" />
                공개
              </Button>
            )}
          </footer>
        </section>
      )}

      {/* 이력 */}
      <section className="rounded-xl border bg-card">
        <button
          type="button"
          className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium"
          onClick={() => {
            const next = !historyOpen;
            setHistoryOpen(next);
            if (next && history === null) void loadHistory();
          }}
        >
          <History className="size-4" />
          버전 이력
          <span className="ml-auto text-xs text-muted-foreground">{historyOpen ? "접기" : "펼치기"}</span>
        </button>
        {historyOpen && (
          <ul className="divide-y border-t">
            {history === null ? (
              <li className="px-4 py-3 text-xs text-muted-foreground">불러오는 중…</li>
            ) : history.length === 0 ? (
              <li className="px-4 py-3 text-xs text-muted-foreground">이력이 없습니다.</li>
            ) : (
              history.map((v) => {
                const isActive = v.id === active?.id;
                return (
                  <li key={v.id} className="flex flex-col gap-2 px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant={isActive ? "default" : "outline"}>
                        {v.status === "confirmed" ? versionLabel(v) : "폐기된 초안"}
                      </Badge>
                      {isActive && <span className="text-brand-green">현재 적용 중</span>}
                      <span className="text-muted-foreground">
                        {v.status === "confirmed"
                          ? `반영 ${v.confirmedBy ?? "-"}${v.appliedVia ? ` (${APPLIED_VIA[v.appliedVia] ?? v.appliedVia})` : ""} · ${formatDateTime(v.confirmedAt)}`
                          : `폐기 ${v.discardedBy ?? "-"} · ${formatDateTime(v.discardedAt)}`}
                      </span>
                      <span className="text-muted-foreground">· 작성 {v.authorId}</span>
                      <div className="ml-auto flex gap-1">
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => setExpanded(expanded === v.id ? null : v.id)}
                        >
                          {expanded === v.id ? "닫기" : "내용"}
                        </Button>
                        {v.status === "confirmed" && !isActive && (
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={text !== null || draft !== undefined}
                            title={text !== null || draft !== undefined ? "진행 중인 초안·공개 제안이 끝난 뒤 가능합니다" : undefined}
                            onClick={() => startDraftFrom(v.content, v)}
                          >
                            <RotateCcw className="size-3" />
                            이 버전으로 초안
                          </Button>
                        )}
                      </div>
                    </div>
                    {v.note && <p className="text-xs break-words text-muted-foreground">{v.note}</p>}
                    {expanded === v.id && (
                      <div className="rounded-md border">
                        <p className="border-b px-3 py-1 text-xs text-muted-foreground">현재 확정본 → 이 버전</p>
                        <DiffView before={active?.content ?? ""} after={v.content} />
                      </div>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        )}
      </section>

      {/* 공개 다이얼로그 */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{doc.title} 공개</DialogTitle>
            <DialogDescription>
              공개하면 {periodHours}시간 이의 기간이 시작됩니다. 작성자·공개자를 뺀 세무사{" "}
              {overview.fastApprovals}명이 승인하면 즉시, 아무도 이의하지 않으면 기한 뒤 자동으로{" "}
              <strong>모든 AI 답변</strong>에 반영됩니다. 이의가 있으면 철회되거나 수정될 때까지 보류됩니다.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border">
            <DiffView before={active?.content ?? ""} after={draft?.content ?? ""} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor={`norm-note-${doc.name}`}>
              변경 사유 · 항목 번호 (필수, 이력에 남습니다)
            </label>
            <input
              id={`norm-note-${doc.name}`}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              취소
            </Button>
            <Button disabled={busy || note.trim().length === 0} onClick={() => void publish()}>
              <Megaphone className="size-3.5" />
              공개 — 이의 기간 시작
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── 화면 ───────────────────────────────────────────────────────────────────────
export function NormsView({ mode }: { mode: Mode }) {
  const userId = useAccountStore((s) => (mode === "auditor" ? s.auditor.id : s.admin.id));
  const [overview, setOverview] = useState<NormsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<NormName>("master");

  const syncPending = useNormsPendingStore((s) => s.setFromOverview);

  const load = async () => {
    setError(null);
    try {
      const next = await normsService.getNorms();
      setOverview(next);
      if (mode === "auditor") syncPending(next, userId); // 배지·팝업이 방금 한 결정을 곧바로 반영
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const drafts = overview?.documents.filter((d) => d.draft?.status === "draft").length ?? 0;
  const proposals = overview?.documents.filter((d) => d.draft?.status === "pending").length ?? 0;
  const fallback = overview && overview.injectedSource !== "db";

  return (
    <div className="flex flex-col gap-5 px-4 py-6 md:px-6">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <ScrollText className="size-6 text-brand-amber" />
            AI 상담 규범
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            검색 없이 <strong>모든 답변</strong>에 들어가는 규범 3종입니다. 초안은 답변에 영향이 없고, 공개하면
            이의 기간을 거쳐(세무사 승인 문턱 도달 시 즉시, 이의가 없으면 기한 뒤 자동) 전 답변에 반영됩니다.
            판정은 여전히 규칙엔진의 권위이며, 이 규범은 설명·자문 문장의 방식을 정합니다.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="size-3.5" />
          새로고침
        </Button>
      </header>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {overview && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline">
            확정본 주입 {overview.activeChars.toLocaleString()} / {overview.maxChars.toLocaleString()}자
          </Badge>
          {drafts > 0 && <Badge variant="secondary">진행 중인 초안 {drafts}건</Badge>}
          {proposals > 0 && <Badge variant="secondary">공개 중 제안 {proposals}건</Badge>}
          {fallback && (
            <span className="flex items-center gap-1 text-destructive">
              <AlertTriangle className="size-3.5" />
              {overview.injectedSource === "md"
                ? "백엔드가 DB 확정본이 아니라 파일 폴백을 주입 중입니다"
                : "백엔드가 규범 없이 답변 중입니다(폴백)"}
            </span>
          )}
        </div>
      )}

      {overview && !overview.dbConfigured && (
        <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
          <AlertTriangle className="size-4" />
          DB 미설정 — 편집할 수 없습니다.
        </div>
      )}

      {loading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">로딩 중…</p>
      ) : overview && overview.documents.length > 0 ? (
        <Tabs value={tab} onValueChange={(v) => setTab(v as NormName)}>
          <TabsList className="w-full md:w-fit">
            {overview.documents.map((d) => (
              <TabsTrigger key={d.name} value={d.name}>
                {TAB_LABEL[d.name] ?? d.title}
                {d.draft && (
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      d.draft.status === "pending" ? "bg-sky-500" : "bg-brand-amber",
                    )}
                    aria-label={d.draft.status === "pending" ? "공개 중 제안 있음" : "초안 있음"}
                  />
                )}
              </TabsTrigger>
            ))}
          </TabsList>
          {overview.documents.map((d) => (
            <TabsContent key={d.name} value={d.name} className="pt-2">
              {/* 서버 초안이 바뀌면(저장·폐기·확정·새로고침) key 로 다시 마운트해 편집 버퍼를 맞춘다. */}
              <NormDocumentPanel
                key={`${d.draft?.id ?? "none"}:${d.draft?.updatedAt ?? 0}:${d.active?.id ?? "none"}`}
                doc={d}
                overview={overview}
                mode={mode}
                userId={userId}
                onChanged={load}
              />
            </TabsContent>
          ))}
        </Tabs>
      ) : null}
    </div>
  );
}
