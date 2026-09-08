"use client";

import { useState } from "react";
import { AlertTriangle, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import * as kb2Service from "@/services/kb2";
import type { Kb2CategorySynthesisResult } from "@/services/kb2";

/**
 * 지식베이스2 합성 (설계 아티팩트 §02·§07, 2026-09-03) — admin 전용 트리거.
 *
 * "지금 시점 RAG로 지식베이스2 재구성" 버튼 하나. 세목(tax_category)별로
 * rag.passages(active) 를 Solar Pro 에 투입해 조항형 문장으로 응축, kb2.sentences
 * 를 재생성한다. locked_by_auditor=true 인 문장(세무사 수정분)은 건드리지 않는다
 * (그래서 재실행할수록 "lockedSkipped" 가 늘어나는 것이 정상 — 최신화 보호막).
 *
 * 이 화면은 auditor 사이드바에는 없다 — /admin 라우트에만 있어 RoleGuard(admin)
 * 로만 보호된다(이 저장소의 기존 admin 전용 컨벤션).
 */
export function Kb2SynthesisView() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Kb2CategorySynthesisResult[] | null>(null);
  const [dbConfigured, setDbConfigured] = useState(true);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await kb2Service.synthesizeKb2();
      setResults(res.results);
      setDbConfigured(res.dbConfigured);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const totalCreated = (results ?? []).reduce((sum, r) => sum + r.created, 0);
  const totalLocked = (results ?? []).reduce((sum, r) => sum + r.lockedSkipped, 0);
  const touched = (results ?? []).filter((r) => r.documentId !== null);

  return (
    <div className="flex flex-col gap-5 px-6 py-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Sparkles className="size-6 text-brand-amber" />
            지식베이스2 합성
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            버튼을 누르면 지금 시점 RAG(활성 상태인 질문/답변/코멘트 묶음)를 세목별로
            모아 Solar Pro 가 조항형 단문 사전으로 응축합니다. 세무사가 이미 수정한
            문장은 재실행해도 그대로 보호됩니다.
          </p>
        </div>
        <Button onClick={() => void run()} disabled={busy}>
          <Sparkles className="size-3.5" />
          {busy ? "합성 중…" : "지금 RAG로 지식베이스2 재구성"}
        </Button>
      </header>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {!dbConfigured && results && (
        <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
          <AlertTriangle className="size-4" />
          RAG DB 미설정 — 합성을 실행할 수 없습니다.
        </div>
      )}

      {results && dbConfigured && (
        <>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">생성/갱신 문장 {totalCreated}건</Badge>
            <Badge variant="outline">보호된(수정됨) 문장 {totalLocked}건</Badge>
            <Badge variant="outline">{touched.length}개 세목 반영</Badge>
          </div>

          {touched.length === 0 ? (
            <div className="rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
              반영된 세목이 없습니다. RAG에 활성 passage가 쌓이면 다시 실행해보세요.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">세목</th>
                    <th className="px-4 py-2 text-right font-medium">생성 문장</th>
                    <th className="px-4 py-2 text-right font-medium">보호(수정됨)</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {touched.map((r) => (
                    <tr key={r.taxCategory}>
                      <td className="px-4 py-2">{r.taxCategory}</td>
                      <td className="px-4 py-2 text-right font-mono">{r.created}</td>
                      <td className="px-4 py-2 text-right font-mono text-muted-foreground">
                        {r.lockedSkipped}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
