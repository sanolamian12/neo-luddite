"use client";

import { useEffect, useMemo, useState } from "react";
import { Library, Pencil, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/poc-format";
import { useAccountStore } from "@/lib/account-store";
import * as kb2Service from "@/services/kb2";
import type { Kb2Document, Kb2Sentence, Kb2SentenceVersion, Kb2SourcePassage } from "@/services/kb2";

/**
 * 지식베이스2(kb2) — auditor 조회·직접 수정 화면(로드맵 4단계).
 *
 * 왼쪽엔 세목별 문서 목록, 오른쪽엔 선택한 문서의 문장 리스트. 각 문장은 인라인으로
 * 수정할 수 있고(kb-passage-detail-view 의 편집 토글 패턴을 그대로 따름), KB2 는
 * rag.passage_edits 식 제안→승인 큐가 아니라 저장 즉시 반영된다 — 대신
 * kb2.sentence_versions 가 전체 이력을 남겨 관리자가 나중에 번복할 근거로 쓴다(5단계).
 * 수정하면 attribution 이 편집한 세무사로 전량 교체된다(기존 기여자는 이 문장의 KB
 * 크레딧을 잃는다 — RAG 크레딧은 원본 passage 가 살아있는 한 별개로 유지).
 */

function SentenceCard({
  sentence,
  auditorId,
  onUpdated,
}: {
  sentence: Kb2Sentence;
  auditorId: string;
  onUpdated: (next: Kb2Sentence) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(sentence.content);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSources, setShowSources] = useState(false);
  const [sources, setSources] = useState<Kb2SourcePassage[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [versions, setVersions] = useState<Kb2SentenceVersion[] | null>(null);

  const startEdit = () => {
    setDraft(sentence.content);
    setError(null);
    setEditing(true);
  };

  const submit = async () => {
    if (!draft.trim() || draft.trim() === sentence.content.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const { sentence: updated } = await kb2Service.updateKb2Sentence(sentence.id, draft.trim(), auditorId);
      if (updated) onUpdated(updated);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleSources = async () => {
    const next = !showSources;
    setShowSources(next);
    if (next && sources === null) {
      try {
        const { passages } = await kb2Service.listKb2SentenceSources(sentence.id);
        setSources(passages);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  };

  const toggleHistory = async () => {
    const next = !showHistory;
    setShowHistory(next);
    if (next && versions === null) {
      try {
        const { versions: v } = await kb2Service.listKb2SentenceVersions(sentence.id);
        setVersions(v);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  };

  return (
    <li className="rounded-xl border bg-card p-4">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="text-[10px]">v{sentence.version}</Badge>
        {sentence.lockedByAuditor && (
          <Badge variant="secondary" className="text-[10px]">세무사 수정됨</Badge>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(sentence.updatedAt)}</span>
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            className="min-h-[80px] w-full rounded-md border bg-background p-2 text-sm"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={submitting}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={submitting}>
              취소
            </Button>
            <Button
              size="sm"
              onClick={() => void submit()}
              disabled={submitting || !draft.trim() || draft.trim() === sentence.content.trim()}
            >
              저장
            </Button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-sm text-foreground">{sentence.content}</p>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {sentence.attribution.map((a) => (
          <span key={a.auditorId} className="rounded-full border border-border bg-muted px-2 py-0.5">
            {a.auditorId} · {Math.round(a.weight * 100)}%
          </span>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {!editing && (
          <Button size="sm" variant="outline" onClick={startEdit}>
            <Pencil className="size-3.5" />
            수정
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => void toggleSources()}>
          출처 보기 {sentence.sourcePassageIds.length > 0 ? `(${sentence.sourcePassageIds.length})` : ""}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void toggleHistory()}>
          버전 히스토리
        </Button>
      </div>

      {showSources && (
        <div className="mt-3 flex flex-col gap-2 rounded-md border border-dashed bg-muted/30 p-3">
          {sources === null ? (
            <p className="text-xs text-muted-foreground">불러오는 중…</p>
          ) : sources.length === 0 ? (
            <p className="text-xs text-muted-foreground">출처 passage 를 찾을 수 없습니다.</p>
          ) : (
            sources.map((p) => (
              <div key={p.id} className="rounded-md bg-background p-2 text-xs">
                {p.taxCategory && <Badge variant="secondary" className="mb-1 text-[10px]">{p.taxCategory}</Badge>}
                <p className="whitespace-pre-wrap text-foreground">{p.content}</p>
                {p.auditorId && <p className="mt-1 text-muted-foreground">{p.auditorId}</p>}
              </div>
            ))
          )}
        </div>
      )}

      {showHistory && (
        <div className="mt-3 flex flex-col gap-2 rounded-md border border-dashed bg-muted/30 p-3">
          {versions === null ? (
            <p className="text-xs text-muted-foreground">불러오는 중…</p>
          ) : versions.length === 0 ? (
            <p className="text-xs text-muted-foreground">이력이 없습니다.</p>
          ) : (
            versions.map((v) => (
              <div key={v.id} className="rounded-md bg-background p-2 text-xs">
                <div className="mb-1 flex items-center gap-1.5 text-muted-foreground">
                  <span className="font-medium text-foreground">v{v.versionNo}</span>
                  <span>·</span>
                  <span>{v.editorType}</span>
                  <span>·</span>
                  <span>{v.editorId}</span>
                  <span className="ml-auto">{formatDateTime(v.createdAt)}</span>
                </div>
                <p className="whitespace-pre-wrap text-foreground">{v.content}</p>
              </div>
            ))
          )}
        </div>
      )}
    </li>
  );
}

export function Kb2View() {
  const auditorId = useAccountStore((s) => s.auditor.id);
  const [documents, setDocuments] = useState<Kb2Document[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sentences, setSentences] = useState<Kb2Sentence[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [loadingSentences, setLoadingSentences] = useState(false);

  const loadDocuments = async () => {
    setLoadingDocs(true);
    setError(null);
    try {
      const { documents: docs } = await kb2Service.listKb2Documents();
      setDocuments(docs);
      setSelectedId((prev) => prev ?? docs[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDocuments([]);
    } finally {
      setLoadingDocs(false);
    }
  };

  useEffect(() => {
    void loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSentences(null);
      return;
    }
    setLoadingSentences(true);
    setError(null);
    kb2Service
      .listKb2Sentences(selectedId)
      .then(({ sentences: rows }) => setSentences(rows))
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setSentences([]);
      })
      .finally(() => setLoadingSentences(false));
  }, [selectedId]);

  const selectedDoc = useMemo(
    () => documents?.find((d) => d.id === selectedId) ?? null,
    [documents, selectedId],
  );

  const handleUpdated = (updated: Kb2Sentence) => {
    setSentences((prev) => (prev ? prev.map((s) => (s.id === updated.id ? updated : s)) : prev));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Library className="size-5 text-brand-green" />
            지식베이스2
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            세목별로 응축된 정책 문장 — 필요하면 직접 수정할 수 있습니다. 수정은 즉시
            반영되고, 이후 재합성에서도 보호됩니다.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadDocuments()} disabled={loadingDocs}>
          <RefreshCw className="size-3.5" />
          새로고침
        </Button>
      </header>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_1fr] lg:items-start">
        <section className="rounded-xl border bg-card">
          <header className="border-b px-4 py-2 text-sm font-semibold">문서(세목)</header>
          {loadingDocs ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">로딩 중…</p>
          ) : (documents ?? []).length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">아직 합성된 문서가 없습니다.</p>
          ) : (
            <ul className="divide-y">
              {(documents ?? []).map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(d.id)}
                    className={cn(
                      "w-full px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/30",
                      selectedId === d.id && "bg-brand-green/10 font-medium text-foreground",
                    )}
                  >
                    {d.taxCategory}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-3">
          {selectedDoc && (
            <h2 className="text-lg font-semibold tracking-tight">{selectedDoc.title}</h2>
          )}
          {loadingSentences ? (
            <p className="py-12 text-center text-sm text-muted-foreground">로딩 중…</p>
          ) : !selectedId ? (
            <p className="rounded-xl border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
              왼쪽에서 문서를 선택하세요.
            </p>
          ) : (sentences ?? []).length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
              이 문서에는 아직 문장이 없습니다.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {(sentences ?? []).map((s) => (
                <SentenceCard key={s.id} sentence={s} auditorId={auditorId} onUpdated={handleUpdated} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
