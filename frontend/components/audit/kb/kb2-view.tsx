"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  GripVertical,
  Library,
  Link2,
  Link2Off,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Wand2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/poc-format";
import { useAccountStore } from "@/lib/account-store";
import * as kb2Service from "@/services/kb2";
import type { Kb2Document, Kb2Group, Kb2Sentence, Kb2SentenceVersion, Kb2SourcePassage } from "@/services/kb2";

/**
 * 지식베이스2(kb2) — auditor 조회·직접 수정 화면(로드맵 4단계 + 4.6단계 2단 트리).
 *
 * 좌측은 대목(kb2.groups) → 세목(kb2.documents) 2단 트리, 우측은 선택한 세목의 문장
 * 리스트 — 인라인 수정, 출처 보기, 버전 히스토리는 4단계 그대로. 이번에 추가된 것:
 * 문서 생성/이름수정/그룹지정(선택 후 [확정]을 눌러야 실제 이동 — 세목 전체가 옮겨가는
 * 큰 변경이라 실수 방지), 문장 클릭→다른 세목으로 이동, 문장 편집 비관적 락(여러 세무사
 * 동시 편집 충돌 방지 — DB에 락 걸고 5분 TTL 로 자동 회수, 1분 무입력이면 클라이언트가
 * 자동저장하고 편집모드를 스스로 나간다), 문장 연결 끊기/재연결(배선실 패턴 — 사유를
 * 필수로 받아 버전 히스토리에 남긴다).
 */

const AUTO_SAVE_IDLE_MS = 60_000;

const EDITOR_TYPE_LABEL: Record<Kb2SentenceVersion["editorType"], string> = {
  system_synthesis: "AI 합성",
  auditor_edit: "세무사 수정",
  admin_revert: "관리자 번복",
  moved: "이동",
  retired: "연결 끊기",
  reconnected: "재연결",
};

/** 연결 끊기/재연결 사유 입력 다이얼로그 — 누가 왜 끊었는지 버전 히스토리에 남기기 위해 필수. */
function StatusReasonDialog({
  open,
  onOpenChange,
  targetStatus,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetStatus: "active" | "retired";
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{targetStatus === "retired" ? "연결 끊기" : "재연결"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            {targetStatus === "retired"
              ? "왜 이 문장의 연결을 끊으시나요? 검색 결과에서 제외되고, 사유는 버전 히스토리에 남습니다."
              : "왜 다시 연결하시나요? 사유는 버전 히스토리에 남습니다."}
          </p>
          <textarea
            className="min-h-[70px] w-full rounded-md border bg-background p-2 text-sm"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="사유 입력"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button
            variant={targetStatus === "retired" ? "destructive" : "default"}
            onClick={() => onConfirm(reason.trim())}
            disabled={!reason.trim()}
          >
            {targetStatus === "retired" ? "연결 끊기" : "재연결"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MoveTargetDialog({
  open,
  onOpenChange,
  documents,
  groups,
  currentDocumentId,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documents: Kb2Document[];
  groups: Kb2Group[];
  currentDocumentId: string;
  onPick: (targetDocumentId: string) => void;
}) {
  const groupLabel = (groupId: string | null | undefined) =>
    groups.find((g) => g.id === groupId)?.label ?? "미분류";
  const targets = documents.filter((d) => d.id !== currentDocumentId);
  const byGroup = useMemo(() => {
    const map = new Map<string, Kb2Document[]>();
    for (const d of targets) {
      const key = d.groupId ?? "__ungrouped__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    return map;
  }, [targets]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>다른 세목으로 이동</DialogTitle>
        </DialogHeader>
        <div className="flex max-h-[50vh] flex-col gap-3 overflow-y-auto">
          {targets.length === 0 ? (
            <p className="text-sm text-muted-foreground">이동할 다른 세목이 없습니다.</p>
          ) : (
            Array.from(byGroup.entries()).map(([key, docs]) => (
              <div key={key} className="flex flex-col gap-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {key === "__ungrouped__" ? "미분류" : groupLabel(key)}
                </p>
                {docs.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => onPick(d.id)}
                    className="rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/40"
                  >
                    {d.title}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SentenceCard({
  sentence,
  auditorId,
  documents,
  groups,
  onUpdated,
  onMoved,
}: {
  sentence: Kb2Sentence;
  auditorId: string;
  documents: Kb2Document[];
  groups: Kb2Group[];
  onUpdated: (next: Kb2Sentence) => void;
  onMoved: (sentenceId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(sentence.content);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockNotice, setLockNotice] = useState<string | null>(null);
  const [showSources, setShowSources] = useState(false);
  const [sources, setSources] = useState<Kb2SourcePassage[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [versions, setVersions] = useState<Kb2SentenceVersion[] | null>(null);
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editingRef = useRef(false);

  const clearIdleTimer = () => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  };

  // 언마운트 시(같은 세션 내 다른 문서로 이동 등) 편집 중이었다면 락을 풀어준다 —
  // 탭을 완전히 닫는 경우는 못 잡지만(서버 TTL 5분이 그 경우의 안전망), 앱 내
  // 네비게이션에서는 이걸로 충분히 즉시 반환된다.
  useEffect(() => {
    return () => {
      clearIdleTimer();
      if (editingRef.current) void kb2Service.releaseKb2SentenceLock(sentence.id, auditorId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentence.id]);

  const finishEditing = async (save: boolean) => {
    clearIdleTimer();
    editingRef.current = false;
    const trimmed = draft.trim();
    if (save && trimmed && trimmed !== sentence.content.trim()) {
      setSubmitting(true);
      setError(null);
      try {
        const { sentence: updated } = await kb2Service.updateKb2Sentence(sentence.id, trimmed, auditorId);
        if (updated) onUpdated(updated);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSubmitting(false);
      }
    } else {
      // 내용 변경 없음 — 저장 왕복 없이 락만 풀고 나간다.
      void kb2Service.releaseKb2SentenceLock(sentence.id, auditorId);
    }
    setEditing(false);
  };

  const resetIdleTimer = () => {
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => void finishEditing(true), AUTO_SAVE_IDLE_MS);
  };

  const startEdit = async () => {
    setError(null);
    setLockNotice(null);
    try {
      const { ok, lockedBy } = await kb2Service.acquireKb2SentenceLock(sentence.id, auditorId);
      if (!ok) {
        setLockNotice(lockedBy ? `${lockedBy}님이 수정 중입니다.` : "지금은 수정할 수 없습니다.");
        return;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setDraft(sentence.content);
    editingRef.current = true;
    setEditing(true);
    resetIdleTimer();
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

  const handleMovePick = async (targetDocumentId: string) => {
    setMovePickerOpen(false);
    try {
      const { sentence: moved } = await kb2Service.moveKb2Sentence(sentence.id, targetDocumentId, auditorId);
      if (moved) onMoved(sentence.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleStatusConfirm = async (reason: string) => {
    const targetStatus = sentence.status === "retired" ? "active" : "retired";
    try {
      const { sentence: updated } = await kb2Service.setKb2SentenceStatus(sentence.id, targetStatus, auditorId, reason);
      if (updated) onUpdated(updated);
      setStatusDialogOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const otherLocked = !editing && sentence.effectivelyLocked && sentence.lockedBy !== auditorId;

  return (
    <li className={cn("rounded-xl border bg-card p-4", sentence.status === "retired" && "opacity-60")}>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          title="다른 세목으로 이동"
          onClick={() => { if (!editing) setMovePickerOpen(true); }}
          className="-m-1.5 rounded p-1.5 text-muted-foreground select-none hover:bg-muted/40 hover:text-foreground active:bg-muted/60"
        >
          <GripVertical className="size-3.5" />
        </button>
        <Badge variant="outline" className="text-[10px]">v{sentence.version}</Badge>
        {sentence.attribution.map((a) => (
          <span key={a.auditorId} className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            {a.auditorId} · {Math.round(a.weight * 100)}%
          </span>
        ))}
        {sentence.lockedByAuditor && (
          <Badge variant="secondary" className="text-[10px]">세무사 수정됨</Badge>
        )}
        {sentence.status === "retired" && (
          <Badge variant="destructive" className="text-[10px]">연결 끊김</Badge>
        )}
        {otherLocked && (
          <Badge variant="destructive" className="text-[10px]">
            <Lock className="size-3 shrink-0" />
            {sentence.lockedBy}님 수정 중
          </Badge>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(sentence.updatedAt)}</span>
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            className="min-h-[80px] w-full rounded-md border bg-background p-2 text-sm"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              resetIdleTimer();
            }}
            disabled={submitting}
          />
          <p className="text-[11px] text-muted-foreground">1분간 입력이 없으면 자동으로 저장됩니다.</p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => void finishEditing(false)} disabled={submitting}>
              취소
            </Button>
            <Button
              size="sm"
              onClick={() => void finishEditing(true)}
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
      {lockNotice && <p className="mt-2 text-xs text-destructive">{lockNotice}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!editing && (
          <Button size="sm" variant="outline" onClick={() => void startEdit()} disabled={otherLocked}>
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
        <Button
          size="sm"
          variant={sentence.status === "retired" ? "default" : "outline"}
          className="ml-auto"
          onClick={() => setStatusDialogOpen(true)}
        >
          {sentence.status === "retired" ? <Link2 className="size-3.5" /> : <Link2Off className="size-3.5" />}
          {sentence.status === "retired" ? "연결" : "연결 끊기"}
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
                  <span>{EDITOR_TYPE_LABEL[v.editorType] ?? v.editorType}</span>
                  <span>·</span>
                  <span>{v.editorId}</span>
                  <span className="ml-auto">{formatDateTime(v.createdAt)}</span>
                </div>
                {v.meta?.reason && (
                  <p className="mb-1 text-muted-foreground">사유: {v.meta.reason}</p>
                )}
                <p className="whitespace-pre-wrap text-foreground">{v.content}</p>
              </div>
            ))
          )}
        </div>
      )}

      <MoveTargetDialog
        open={movePickerOpen}
        onOpenChange={setMovePickerOpen}
        documents={documents}
        groups={groups}
        currentDocumentId={sentence.documentId}
        onPick={(targetId) => void handleMovePick(targetId)}
      />
      <StatusReasonDialog
        open={statusDialogOpen}
        onOpenChange={setStatusDialogOpen}
        targetStatus={sentence.status === "retired" ? "active" : "retired"}
        onConfirm={(reason) => void handleStatusConfirm(reason)}
      />
    </li>
  );
}

export function Kb2View() {
  const auditorId = useAccountStore((s) => s.auditor.id);
  const [groups, setGroups] = useState<Kb2Group[] | null>(null);
  const [documents, setDocuments] = useState<Kb2Document[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sentences, setSentences] = useState<Kb2Sentence[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingSentences, setLoadingSentences] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupLabel, setGroupLabel] = useState("");
  const [documentDialogOpen, setDocumentDialogOpen] = useState(false);
  const [documentTitle, setDocumentTitle] = useState("");
  const [documentGroupChoice, setDocumentGroupChoice] = useState<string>("__ungrouped__");
  const [autoGrouping, setAutoGrouping] = useState(false);
  const [autoGroupNotice, setAutoGroupNotice] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [groupChoiceDraft, setGroupChoiceDraft] = useState<string>("__ungrouped__");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ groups: g }, { documents: d }] = await Promise.all([
        kb2Service.listKb2Groups(),
        kb2Service.listKb2Documents(),
      ]);
      setGroups(g);
      setDocuments(d);
      setSelectedId((prev) => prev ?? d[0]?.id ?? null);
      setExpanded((prev) => (prev.size > 0 ? prev : new Set(g.map((x) => x.id).concat("__ungrouped__"))));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setGroups([]);
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
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

  // 세목 전체가 다른 대목으로 옮겨가는 큰 변경이라, select 값이 바뀌는 즉시 적용하지
  // 않고 [확정]을 눌러야 실제로 이동한다 — 선택된 세목이 바뀌면 드래프트도 그 세목의
  // 현재 대목으로 리셋.
  useEffect(() => {
    setGroupChoiceDraft(selectedDoc?.groupId ?? "__ungrouped__");
  }, [selectedDoc?.id, selectedDoc?.groupId]);

  const byGroup = useMemo(() => {
    const map = new Map<string, Kb2Document[]>();
    for (const d of documents ?? []) {
      const key = d.groupId ?? "__ungrouped__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    return map;
  }, [documents]);

  const toggleGroup = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleUpdated = (updated: Kb2Sentence) => {
    setSentences((prev) => (prev ? prev.map((s) => (s.id === updated.id ? updated : s)) : prev));
  };

  const handleMoved = (sentenceId: string) => {
    setSentences((prev) => (prev ? prev.filter((s) => s.id !== sentenceId) : prev));
  };

  const autoGroup = async () => {
    setAutoGrouping(true);
    setError(null);
    try {
      const { groupsCreated, documentsGrouped } = await kb2Service.autoGroupKb2Documents();
      await load();
      if (groupsCreated === 0) {
        setAutoGroupNotice("미분류 세목이 없거나, 카테고리 제안에 실패했습니다.");
      } else {
        setAutoGroupNotice(`대목 ${groupsCreated}개 생성, 세목 ${documentsGrouped}건 배정 완료.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAutoGrouping(false);
    }
  };

  const submitGroup = async () => {
    if (!groupLabel.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await kb2Service.createKb2Group(groupLabel.trim());
      setGroupLabel("");
      setGroupDialogOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitDocument = async () => {
    if (!documentTitle.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const groupId = documentGroupChoice === "__ungrouped__" ? null : documentGroupChoice;
      const { document } = await kb2Service.createKb2Document(groupId, documentTitle.trim());
      setDocumentTitle("");
      setDocumentGroupChoice("__ungrouped__");
      setDocumentDialogOpen(false);
      await load();
      if (document) setSelectedId(document.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitRename = async () => {
    if (!selectedDoc || !renameDraft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await kb2Service.renameKb2Document(selectedDoc.id, renameDraft.trim());
      setRenameOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmDocumentGroup = async () => {
    if (!selectedDoc) return;
    setBusy(true);
    setError(null);
    try {
      await kb2Service.setKb2DocumentGroup(
        selectedDoc.id, groupChoiceDraft === "__ungrouped__" ? null : groupChoiceDraft,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const groupEntries: Array<{ key: string; label: string }> = [
    ...(groups ?? []).map((g) => ({ key: g.id, label: g.label })),
    { key: "__ungrouped__", label: "미분류" },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Library className="size-5 text-brand-green" />
            지식베이스2
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            대목·세목별로 응축된 정책 문장 — 필요하면 직접 수정할 수 있습니다. 수정은 즉시
            반영되고, 이후 재합성에서도 보호됩니다.
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr] lg:items-start">
        <section className="rounded-xl border bg-card">
          <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <span className="text-sm font-semibold">문서(세목)</span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setGroupDialogOpen(true)} title="대목 추가">
                <FolderPlus className="size-3.5" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDocumentDialogOpen(true)} title="세목 추가">
                <Plus className="size-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void autoGroup()}
                disabled={autoGrouping}
                title="미분류 세목을 표준 세무 대분류로 자동 그룹화"
              >
                <Wand2 className="size-3.5" />
              </Button>
            </div>
          </header>
          {autoGroupNotice && (
            <p className="border-b bg-brand-green/5 px-3 py-1.5 text-[11px] text-muted-foreground">
              {autoGroupNotice}
            </p>
          )}
          {loading ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">로딩 중…</p>
          ) : groupEntries.every((g) => (byGroup.get(g.key) ?? []).length === 0) ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">아직 세목이 없습니다.</p>
          ) : (
            <ul className="py-1">
              {groupEntries.map(({ key, label }) => {
                const docs = byGroup.get(key) ?? [];
                const isOpen = expanded.has(key);
                return (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(key)}
                      className="flex w-full items-center gap-1 px-3 py-1.5 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                      {label}
                      <span className="ml-auto text-[10px]">{docs.length}</span>
                    </button>
                    {isOpen && (
                      <ul>
                        {docs.map((d) => (
                          <li key={d.id}>
                            <button
                              type="button"
                              onClick={() => setSelectedId(d.id)}
                              className={cn(
                                "w-full py-2 pl-8 pr-3 text-left text-sm transition-colors hover:bg-muted/30",
                                selectedId === d.id && "bg-brand-green/10 font-medium text-foreground",
                              )}
                            >
                              {d.title}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-3">
          {selectedDoc && (
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight">{selectedDoc.title}</h2>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setRenameDraft(selectedDoc.title);
                  setRenameOpen(true);
                }}
              >
                <Pencil className="size-3.5" />
                이름 수정
              </Button>
              <select
                value={groupChoiceDraft}
                onChange={(e) => setGroupChoiceDraft(e.target.value)}
                className="rounded-md border bg-background px-2 py-1 text-sm"
                disabled={busy}
              >
                {groupEntries.map((g) => (
                  <option key={g.key} value={g.key}>{g.label}</option>
                ))}
              </select>
              <Button
                size="sm"
                onClick={() => void confirmDocumentGroup()}
                disabled={busy || groupChoiceDraft === (selectedDoc.groupId ?? "__ungrouped__")}
              >
                이 세목을 여기로 이동 [확정]
              </Button>
            </div>
          )}
          {loadingSentences ? (
            <p className="py-12 text-center text-sm text-muted-foreground">로딩 중…</p>
          ) : !selectedId ? (
            <p className="rounded-xl border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
              왼쪽에서 세목을 선택하세요.
            </p>
          ) : (sentences ?? []).length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
              이 세목에는 아직 문장이 없습니다.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {(sentences ?? []).map((s) => (
                <SentenceCard
                  key={s.id}
                  sentence={s}
                  auditorId={auditorId}
                  documents={documents ?? []}
                  groups={groups ?? []}
                  onUpdated={handleUpdated}
                  onMoved={handleMoved}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>대목 추가</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="대목 이름"
            value={groupLabel}
            onChange={(e) => setGroupLabel(e.target.value)}
            disabled={busy}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setGroupDialogOpen(false)} disabled={busy}>취소</Button>
            <Button onClick={() => void submitGroup()} disabled={busy || !groupLabel.trim()}>추가</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={documentDialogOpen} onOpenChange={setDocumentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>세목 추가</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input
              placeholder="세목 이름"
              value={documentTitle}
              onChange={(e) => setDocumentTitle(e.target.value)}
              disabled={busy}
            />
            <select
              value={documentGroupChoice}
              onChange={(e) => setDocumentGroupChoice(e.target.value)}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
              disabled={busy}
            >
              {groupEntries.map((g) => (
                <option key={g.key} value={g.key}>{g.label}</option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDocumentDialogOpen(false)} disabled={busy}>취소</Button>
            <Button onClick={() => void submitDocument()} disabled={busy || !documentTitle.trim()}>추가</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>이름 수정</DialogTitle>
          </DialogHeader>
          <Input
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            disabled={busy}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)} disabled={busy}>취소</Button>
            <Button onClick={() => void submitRename()} disabled={busy || !renameDraft.trim()}>저장</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
