"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isPrototype } from "@/lib/data-mode";
import { APPLICATION_STATUS_LABEL, type ApplicationStatus } from "@/services/expert-application";
import {
  ADMIN_DELETE_CONFIRM_WORD,
  type AdminUserRow,
  PROVIDER_LABEL,
  ROLE_LABEL,
  type UserRole,
  deleteAccount,
  listUsers,
} from "@/services/admin-monitoring";

const PAGE = 50;
const fmtDate = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString("ko-KR") : "—");
const fmtDateTime = (ms: number | null) => (ms ? new Date(ms).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" }) : "—");
const providers = (row: AdminUserRow) => row.providers.map((p) => PROVIDER_LABEL[p] ?? p).join(", ") || "—";
const appStatus = (s: string | null) => (s ? APPLICATION_STATUS_LABEL[s as ApplicationStatus] ?? s : null);

/** 사용자 (/admin/users) — 전체 계정 목록과 계정 삭제(0048 admin_delete_account). 관리자 계정은 삭제 불가. */
export function UsersView() {
  const [role, setRole] = useState<UserRole | null>(null);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ rows: AdminUserRow[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<AdminUserRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await listUsers({ role, q: query, limit: PAGE, offset })); setError(null); }
    catch { setError("사용자 목록을 불러오지 못했어요."); }
  }, [role, query, offset]);
  useEffect(() => {
    // 조회 결과를 state 에 담는 마운트·조건 변경 시 조회(kb3-share-view 와 같은 패턴)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!isPrototype) void load();
  }, [load]);

  if (isPrototype) return <Shell><p className="text-muted-foreground">사용자 목록은 운영 데이터에서만 볼 수 있어요.</p></Shell>;

  const roles: (UserRole | null)[] = [null, "user", "auditor", "admin"];
  return (
    <Shell total={data?.total}>
      <div className="flex flex-wrap items-center gap-2">
        {roles.map((r) => (
          <Button key={r ?? "all"} size="sm" variant={role === r ? "default" : "outline"} onClick={() => { setRole(r); setOffset(0); }}>
            {r ? ROLE_LABEL[r] : "전체"}
          </Button>
        ))}
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(q); setOffset(0); }}>
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·이메일·ID" aria-label="사용자 검색" className="h-8 w-48" />
          <Button type="submit" size="sm" variant="outline">검색</Button>
        </form>
      </div>
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {data === null ? <p role="status" className="text-muted-foreground">불러오는 중…</p>
        : data.rows.length === 0 ? <p className="py-12 text-center text-muted-foreground">해당하는 사용자가 없어요.</p>
        : <>
          <div className="ds-panel hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  {["사용자", "역할", "가입 경로", "가입일", "최근 접속", "대화", "세무사 신청", ""].map((h, i) => (
                    <th key={i} className={`px-3 py-2 font-medium ${h === "대화" ? "text-right" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.domainId} className="border-t">
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.displayName}</div>
                      <div className="text-xs text-muted-foreground">{row.email ?? "이메일 없음"}</div>
                      <div className="max-w-[16rem] truncate font-mono text-[11px] text-muted-foreground" title={row.domainId}>{row.domainId}</div>
                    </td>
                    <td className="px-3 py-2">{ROLE_LABEL[row.role]}</td>
                    <td className="px-3 py-2 text-xs">{providers(row)}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(row.createdAt)}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDateTime(row.lastSignInAt)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.conversationCount}</td>
                    <td className="px-3 py-2 text-xs">{appStatus(row.applicationStatus) ?? "—"}</td>
                    <td className="px-3 py-2 text-right">
                      {row.role !== "admin" && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { setNotice(null); setTarget(row); }}>삭제</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col gap-2 md:hidden">
            {data.rows.map((row) => (
              <li key={row.domainId} className="ds-panel flex flex-col gap-1 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{row.displayName}</span>
                  <span className="text-xs text-muted-foreground">{ROLE_LABEL[row.role]} · {providers(row)}</span>
                </div>
                <div className="text-xs text-muted-foreground">{row.email ?? "이메일 없음"}</div>
                <div className="text-xs text-muted-foreground">가입 {fmtDate(row.createdAt)} · 최근 접속 {fmtDateTime(row.lastSignInAt)} · 대화 {row.conversationCount}건{appStatus(row.applicationStatus) ? ` · 신청 ${appStatus(row.applicationStatus)}` : ""}</div>
                {row.role !== "admin" && <Button size="sm" variant="ghost" className="self-end text-destructive" onClick={() => { setNotice(null); setTarget(row); }}>삭제</Button>}
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-end gap-2 text-sm">
            <span className="text-muted-foreground">{offset + 1}–{offset + data.rows.length} / {data.total}</span>
            <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>이전</Button>
            <Button size="sm" variant="outline" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>다음</Button>
          </div>
        </>}
      <DeleteDialog target={target} onClose={() => setTarget(null)} onDeleted={(row) => {
        setTarget(null);
        setNotice(`${row.displayName} 계정과 관련 기록을 삭제했어요.`);
        void load();
      }} />
    </Shell>
  );
}

function Shell({ total, children }: { total?: number; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">사용자</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {total !== undefined && <>{total}명 · </>}가입 경로·최근 접속·상담 대화 수. 삭제하면 계정과 상담 기록이 즉시 파기됩니다(되돌릴 수 없음).
        </p>
      </header>
      {children}
    </div>
  );
}

function DeleteDialog({ target, onClose, onDeleted }: { target: AdminUserRow | null; onClose: () => void; onDeleted: (row: AdminUserRow) => void }) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      {/* 대상마다 다시 마운트 — 확인 문구·오류가 이전 대상에서 넘어오지 않게 */}
      {target && <DeleteForm key={target.domainId} target={target} onClose={onClose} onDeleted={onDeleted} />}
    </Dialog>
  );
}

function DeleteForm({ target, onClose, onDeleted }: { target: AdminUserRow; onClose: () => void; onDeleted: (row: AdminUserRow) => void }) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (confirm.trim() !== ADMIN_DELETE_CONFIRM_WORD || busy) return;
    setBusy(true);
    setError(null);
    try { await deleteAccount(target.domainId); onDeleted(target); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "삭제하지 못했어요."); setBusy(false); }
  }

  return (
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{target.displayName} 계정 삭제</DialogTitle>
          <DialogDescription>
            계정, 상담 대화, 검수 기록, 상담 신청·상담방, 지식베이스에 반영된 질문이 즉시 삭제돼요.
            {target.role === "auditor" && " 세무사 카드·AI 도우미 설정·작성한 세무사 사례(공용 공유분 포함)는 삭제되고, 세무사 기록은 상담·정산 이력 보존을 위해 이름을 '탈퇴한 세무사'로 바꾸고 연락처를 지운 채 정지 상태로 남아요."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="admin-delete-confirm">확인을 위해 &lsquo;{ADMIN_DELETE_CONFIRM_WORD}&rsquo;를 입력해 주세요</Label>
          <Input id="admin-delete-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>취소</Button>
          <Button variant="destructive" onClick={() => void remove()} disabled={busy || confirm.trim() !== ADMIN_DELETE_CONFIRM_WORD}>{busy ? "삭제하는 중…" : "삭제"}</Button>
        </DialogFooter>
      </DialogContent>
  );
}
