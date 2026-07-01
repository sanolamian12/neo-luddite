"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OCCUPATIONS, getOccupation } from "@/lib/occupations";
import { useUploadedConversationStore } from "@/lib/uploaded-conversation-store";
import {
  parseWorkbook,
  buildConversation,
  estimateTokens,
  type IntakeRow,
} from "@/lib/xlsx-intake";
import * as poolService from "@/services/pool";

const DEFAULT_OCCUPATION = "clinic";

interface RowState extends IntakeRow {
  occupation: string;
}

export function PoolUpload() {
  const addMany = useUploadedConversationStore((s) => s.addMany);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<RowState[]>([]);
  const [defaultOcc, setDefaultOcc] = useState<string>(DEFAULT_OCCUPATION);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createdIds, setCreatedIds] = useState<string[] | null>(null);

  const validCount = useMemo(
    () => rows.filter((r) => r.answer.trim().length > 0).length,
    [rows],
  );

  const onFile = async (file: File | null) => {
    setError(null);
    setCreatedIds(null);
    if (!file) return;
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseWorkbook(buf);
      if (parsed.length === 0) {
        setError("행을 찾지 못했습니다. A열=질문, B열=답변 형식인지 확인하세요.");
        setRows([]);
        return;
      }
      setRows(parsed.map((r) => ({ ...r, occupation: defaultOcc })));
    } catch (e) {
      setError(`파싱 실패: ${e instanceof Error ? e.message : String(e)}`);
      setRows([]);
    }
  };

  const applyDefaultToAll = () =>
    setRows((prev) => prev.map((r) => ({ ...r, occupation: defaultOcc })));

  const setRowOcc = (idx: number, occ: string) =>
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, occupation: occ } : r)),
    );

  const onCreate = async () => {
    setError(null);
    const batch = Date.now();
    const convs = [];
    const candidateInputs = [];
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const id = `conv_upload_${batch}_${i}`;
      const occLabel = getOccupation(r.occupation)?.label ?? r.occupation;
      const conv = buildConversation(r, r.occupation, occLabel, id);
      if (!conv) {
        skipped += 1;
        continue;
      }
      convs.push(conv);
      candidateInputs.push({
        conversationId: id,
        occupation: r.occupation,
        topic: (r.question || "엑셀 화물").slice(0, 60),
        turnCount: 2,
        firstUserMessage: r.question,
        assistantTokenEstimate: estimateTokens(r.answer),
      });
    }

    if (convs.length === 0) {
      setError("등록 가능한 유효 행이 없습니다(답변이 비어있을 수 있음).");
      return;
    }

    setCreating(true);
    try {
      addMany(convs);
      for (const input of candidateInputs) await poolService.add(input);
      setCreatedIds(convs.map((c) => c.id));
      if (skipped > 0) {
        setError(`${skipped}건은 답변이 비어 건너뛰었습니다.`);
      }
    } catch (e) {
      setError(`등록 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 px-6 py-6 max-w-5xl">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">하차장 — 엑셀 화물 업로드</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A열 = 질문, B열 = Upstage 답변. 각 행이 1개의 화물(대화)로 등록됩니다.
          </p>
        </div>
        <Button variant="ghost" render={<Link href="/admin/pool" />}>
          목록으로
        </Button>
      </div>

      {/* 업로드 */}
      <section className="flex flex-col gap-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
          {fileName && (
            <span className="text-xs text-muted-foreground">{fileName}</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground">기본 분류</span>
            <OccSelect value={defaultOcc} onChange={setDefaultOcc} />
            <Button size="sm" variant="outline" onClick={applyDefaultToAll} disabled={rows.length === 0}>
              전체 적용
            </Button>
          </div>
        </div>
        {error && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
            {error}
          </div>
        )}
      </section>

      {/* 미리보기 */}
      {rows.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              미리보기 · {rows.length}행 (유효 {validCount})
            </h2>
          </div>
          <div className="overflow-hidden rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <Th className="w-10 text-right">#</Th>
                  <Th>질문 (A열)</Th>
                  <Th>답변 (B열)</Th>
                  <Th className="w-40">분류</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t align-top">
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-2 max-w-[280px]">
                      <p className="line-clamp-2">{r.question || <span className="text-muted-foreground">(없음)</span>}</p>
                    </td>
                    <td className="px-3 py-2 max-w-[360px]">
                      {r.answer ? (
                        <p className="line-clamp-2 text-muted-foreground">{r.answer}</p>
                      ) : (
                        <Badge variant="ghost">답변 없음 · 건너뜀</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <OccSelect value={r.occupation} onChange={(v) => setRowOcc(i, v)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 액션 / 결과 */}
      {createdIds ? (
        <section className="flex flex-col gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
            ✓ {createdIds.length}건의 화물을 등록했습니다.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              render={
                <Link
                  href={`/admin/tasks/new?conversationIds=${encodeURIComponent(createdIds.join(","))}`}
                />
              }
            >
              선택 화물로 일감 등록 →
            </Button>
            <Button size="sm" variant="outline" render={<Link href="/admin/pool" />}>
              후보 풀 보기
            </Button>
          </div>
        </section>
      ) : (
        rows.length > 0 && (
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" render={<Link href="/admin/pool" />}>
              취소
            </Button>
            <Button onClick={onCreate} disabled={creating || validCount === 0}>
              {creating ? "등록 중…" : `화물 등록 (${validCount}건)`}
            </Button>
          </div>
        )
      )}
    </div>
  );
}

function OccSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-md border bg-background px-2 text-xs"
    >
      {OCCUPATIONS.map((o) => (
        <option key={o.key} value={o.key}>
          {o.emoji} {o.label}
        </option>
      ))}
    </select>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-medium ${className ?? ""}`}>{children}</th>;
}
