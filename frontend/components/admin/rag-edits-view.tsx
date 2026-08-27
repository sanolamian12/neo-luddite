"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, FileEdit, RefreshCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/poc-format";
import { useAccountStore } from "@/lib/account-store";
import * as ragService from "@/services/rag";
import type { PassageEdit } from "@/services/rag";

/**
 * §3.4 admin 승인/반려 워크플로우 — auditor 가 KB 지식망 상세뷰(/audit/kb-map/[id])에서
 * 낸 passage 수정 제안을 admin 이 diff 로 확인하고 승인/반려한다.
 *
 * 기여 정책(2026-08-27 확정): 승인돼도 rag.passages 의 reviewer/auditor_id(귀속)는
 * 절대 바뀌지 않는다 — 원작성자의 존속기간 기여가 그대로 유지되고, 수정은 이력으로만
 * 남는다. 그래서 이 화면엔 "누구에게 크레딧을 줄지" 선택지가 없다 — 승인/반려 뿐.
 * 승인 시 백엔드가 제안 텍스트를 재임베딩해 content/embedding 을 갱신한다.
 */
export function RagEditsView() {
  const adminId = useAccountStore((s) => s.admin.id);
  const [edits, setEdits] = useState<PassageEdit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dbConfigured, setDbConfigured] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await ragService.listEdits({ status: "pending" });
      setEdits(res.edits);
      setDbConfigured(res.dbConfigured);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEdits([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const approve = async (edit: PassageEdit) => {
    setBusyId(edit.id);
    setError(null);
    try {
      await ragService.approveEdit(edit.id, adminId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (edit: PassageEdit) => {
    setBusyId(edit.id);
    setError(null);
    try {
      await ragService.rejectEdit(edit.id, adminId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-5 px-6 py-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <FileEdit className="size-6 text-brand-amber" />
            KB 수정 제안 승인
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            세무사가 KB 지식망 상세뷰에서 낸 내용 수정 제안입니다. 승인하면 해당 passage 의
            내용과 벡터가 갱신됩니다. 승인 여부와 무관하게 <strong>존속기간 기여(정산 기준)는
            원작성자에게 그대로 유지</strong>됩니다 — 수정은 이력으로만 남습니다.
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

      {!dbConfigured && !loading && (
        <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
          <AlertTriangle className="size-4" />
          RAG DB 미설정 — 조회 결과가 없습니다.
        </div>
      )}

      {loading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">로딩 중…</p>
      ) : (edits ?? []).length === 0 ? (
        <div className="rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          대기 중인 수정 제안이 없습니다.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {(edits ?? []).map((edit) => (
            <section key={edit.id} className="overflow-hidden rounded-xl border bg-card">
              <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
                <Badge variant="outline">{edit.editorReviewer ?? edit.editorAuditorId}</Badge>
                <span>{formatDateTime(edit.createdAt)}</span>
                <span className="ml-auto font-mono">passage {edit.passageId.slice(0, 8)}…</span>
              </header>
              <div className="grid grid-cols-1 divide-y md:grid-cols-2 md:divide-x md:divide-y-0">
                <div className="px-4 py-3">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">현재 내용</p>
                  <p className="whitespace-pre-wrap text-sm">{edit.originalContent}</p>
                </div>
                <div className="px-4 py-3">
                  <p className="mb-1 text-xs font-medium text-brand-amber">제안된 내용</p>
                  <p className="whitespace-pre-wrap text-sm">{edit.proposedContent}</p>
                </div>
              </div>
              <footer className="flex justify-end gap-2 border-t px-4 py-2.5">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === edit.id}
                  onClick={() => void reject(edit)}
                >
                  <X className="size-3.5" />
                  반려
                </Button>
                <Button size="sm" disabled={busyId === edit.id} onClick={() => void approve(edit)}>
                  <Check className="size-3.5" />
                  승인
                </Button>
              </footer>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
