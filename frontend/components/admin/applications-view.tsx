"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { isPrototype } from "@/lib/data-mode";
import { cn } from "@/lib/utils";
import {
  APPLICATION_STATUS_LABEL,
  type ApplicationRow,
  type ApplicationStatus,
  applicationErrorMessage,
  listApplications,
  reviewApplication,
} from "@/services/expert-application";
import { refreshPendingApplications } from "@/lib/pending-applications";

const STATUS_TONE: Record<ApplicationStatus, string | undefined> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  withdrawn: undefined,
};

function StatusChip({ status }: { status: ApplicationStatus }) {
  return <span className="ds-status" data-status={STATUS_TONE[status]}><span aria-hidden />{APPLICATION_STATUS_LABEL[status]}</span>;
}

const fmt = (ms: number | null) => (ms ? new Date(ms).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" }) : "—");

/**
 * 세무사 가입 신청 심사 (/admin/applications). 관리자가 등록번호로 세무사 등록 여부를 직접 조회하고
 * "확인함"을 표시해야 승인할 수 있다. 승인 = 같은 계정이 세무사가 된다(0049 review_expert_application).
 */
export function ApplicationsView() {
  const [rows, setRows] = useState<ApplicationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await listApplications()); setError(null); }
    catch (cause) { setError(applicationErrorMessage(cause)); }
  }, []);
  useEffect(() => {
    // 조회 결과를 state 에 담는 마운트·조건 변경 시 조회(kb3-share-view 와 같은 패턴)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!isPrototype) void load();
  }, [load]);

  const visible = useMemo(() => (rows ?? []).filter((r) => filter === "all" || r.status === "pending"), [rows, filter]);
  const selected = visible.find((r) => r.id === selectedId) ?? visible[0] ?? null;
  const pendingCount = rows?.filter((r) => r.status === "pending").length ?? 0;

  const onDecided = (row: ApplicationRow) => {
    setRows((cur) => cur?.map((r) => (r.id === row.id ? row : r)) ?? cur);
    void refreshPendingApplications();
  };

  if (isPrototype) return <Shell><p className="text-muted-foreground">세무사 가입 신청은 운영 데이터에서만 볼 수 있어요.</p></Shell>;

  return (
    <Shell pendingCount={rows ? pendingCount : undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={filter === "pending" ? "default" : "outline"} onClick={() => setFilter("pending")}>검토 중</Button>
        <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>전체</Button>
        <Button size="sm" variant="ghost" onClick={() => void load()}>새로고침</Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {rows === null ? <p role="status" className="text-muted-foreground">불러오는 중…</p>
        : visible.length === 0 ? <p className="py-12 text-center text-muted-foreground">{filter === "pending" ? "검토할 신청이 없어요." : "신청 내역이 없어요."}</p>
        : <div className="grid gap-4 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <ul className="flex flex-col gap-2" aria-label="신청 목록">
            {visible.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setSelectedId(r.id)} aria-pressed={selected?.id === r.id}
                  className={cn("w-full rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted/40",
                    selected?.id === r.id && "border-primary bg-primary/5")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{r.name}</span>
                    <StatusChip status={r.status} />
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{r.officeName} · {r.officeRegion}</div>
                  <div className="text-xs text-muted-foreground">{fmt(r.createdAt)}</div>
                </button>
              </li>
            ))}
          </ul>
          {selected && <ApplicationDetail key={selected.id} row={selected} onDecided={onDecided} />}
        </div>}
    </Shell>
  );
}

function Shell({ pendingCount, children }: { pendingCount?: number; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">세무사 가입 신청</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {pendingCount !== undefined && <>검토 대기 {pendingCount}건 · </>}
          등록번호와 이름으로 세무사 등록 여부를 직접 조회한 뒤 승인하세요. 승인하면 신청한 계정이 세무사 계정이 됩니다.
        </p>
      </header>
      {children}
    </div>
  );
}

function ApplicationDetail({ row, onDecided }: { row: ApplicationRow; onDecided: (r: ApplicationRow) => void }) {
  const [verified, setVerified] = useState(false);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<"idle" | "reject">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approved" | "rejected") {
    if (busy) return;
    if (decision === "approved" && !window.confirm(`${row.name} 님을 세무사로 승인할까요? 이 계정의 역할이 세무사로 바뀝니다.`)) return;
    setBusy(true);
    setError(null);
    try {
      onDecided(await reviewApplication({ id: row.id, decision, verified, reason: reason.trim() || undefined, note: note.trim() || undefined }));
    } catch (cause) {
      setError(applicationErrorMessage(cause));
      setBusy(false);
    }
  }

  const fields: [string, React.ReactNode][] = [
    ["이름", row.name],
    ["등록번호", <span key="r" className="font-mono">{row.registrationNo}</span>],
    ["사무소", `${row.officeName} · ${row.officeRegion}`],
    ["연락 이메일", row.email],
    ["휴대폰", row.phone],
    ["경력", `${row.yearsExperience}년`],
    ["전문 분야", row.specialties.length ? <span key="s" className="flex flex-wrap gap-1">{row.specialties.map((s) => <Badge key={s} variant="secondary">{s}</Badge>)}</span> : "—"],
    ["소개", row.bio || "—"],
    ["계정", <span key="d" className="font-mono text-xs break-all">{row.applicantDomain}</span>],
    ["접수", fmt(row.createdAt)],
  ];

  return (
    <section className="ds-panel flex flex-col gap-5 p-4" aria-label={`${row.name} 신청서`}>
      <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        {fields.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="whitespace-pre-wrap break-words">{v}</dd></div>)}
      </dl>

      {row.status === "pending" ? <div className="flex flex-col gap-3 border-t pt-4">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} className="mt-1 size-4" />
          <span>한국세무사회 회원 조회 등으로 <strong>이름·등록번호가 일치하는 등록 세무사</strong>임을 확인했습니다.</span>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">확인 메모 (관리자만 봄)</span>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="예: 10/8 세무사회 조회, 사무소 일치" />
        </label>
        {mode === "reject" && <label className="flex flex-col gap-1 text-sm">
          <span>반려 사유 (신청자에게 보임) *</span>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus />
        </label>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {mode === "reject" ? <>
            <Button variant="ghost" onClick={() => setMode("idle")} disabled={busy}>취소</Button>
            <Button variant="destructive" onClick={() => void decide("rejected")} disabled={busy || !reason.trim()}>{busy ? "처리 중…" : "반려하기"}</Button>
          </> : <>
            <Button variant="outline" onClick={() => setMode("reject")} disabled={busy}>반려</Button>
            <Button onClick={() => void decide("approved")} disabled={busy || !verified}>{busy ? "처리 중…" : "승인"}</Button>
          </>}
        </div>
      </div> : <div className="flex flex-col gap-2 border-t pt-4 text-sm">
        <p className="flex items-center gap-2"><StatusChip status={row.status} /> {fmt(row.decidedAt)}</p>
        {row.rejectReason && <p className="whitespace-pre-wrap">반려 사유: {row.rejectReason}</p>}
        {row.reviewNote && <p className="whitespace-pre-wrap text-muted-foreground">확인 메모: {row.reviewNote}</p>}
        {row.status === "approved" && <Link href={`/admin/auditors/${encodeURIComponent(row.applicantDomain)}`} className="underline underline-offset-4">전문가 관리에서 보기</Link>}
        {(row.status === "rejected" || row.status === "withdrawn") && <p className="text-xs text-muted-foreground">반려·철회된 신청서는 처리 30일 뒤 자동 파기됩니다.</p>}
      </div>}
    </section>
  );
}
