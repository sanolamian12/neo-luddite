"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Copy,
  Pencil,
  ShieldCheck,
  X,
} from "lucide-react";
import { useAccountStore } from "@/lib/account-store";
import * as api from "@/services/kb2";
import type {
  Kb2Sentence,
  Kb2SentenceVersion,
  Kb2SourcePassage,
} from "@/services/kb2";
import styles from "./kb2-atlas.module.css";

const versionLabels: Record<Kb2SentenceVersion["editorType"], string> = {
  system_synthesis: "AI 합성",
  system_unsorted: "원문 보관",
  auditor_edit: "전문가 수정",
  admin_revert: "관리자 복원",
  moved: "이동",
  retired: "연결 끊기",
  reconnected: "재연결",
};

export function AtlasInspector({
  sentence,
  onSaved,
  onClose,
  onEditing,
}: {
  sentence: Kb2Sentence;
  onSaved: (sentence: Kb2Sentence) => void;
  onClose: () => void;
  onEditing: (editing: boolean) => void;
}) {
  const auditorId = useAccountStore((s) => s.auditor.id);
  const [sources, setSources] = useState<Kb2SourcePassage[]>([]);
  const [versions, setVersions] = useState<Kb2SentenceVersion[]>([]);
  const [evidenceState, setEvidenceState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [retry, setRetry] = useState(0);
  const [tab, setTab] = useState<"sources" | "history">("sources");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(sentence.content);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const alive = useRef(true);
  const hasLock = useRef(false);
  const draftKey = `kb2-atlas-draft:${auditorId}:${sentence.id}`;

  useEffect(() => {
    alive.current = true;
    heading.current?.focus({ preventScroll: true });
    if (window.matchMedia("(max-width: 900px)").matches)
      heading.current?.scrollIntoView({ block: "start" });
    return () => {
      alive.current = false;
      if (hasLock.current)
        void api.releaseKb2SentenceLock(sentence.id, auditorId).catch(() => {});
    };
  }, [sentence.id, auditorId]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.listKb2SentenceSources(sentence.id),
      api.listKb2SentenceVersions(sentence.id),
    ])
      .then(([s, v]) => {
        if (cancelled) return;
        if (!s.dbConfigured || !v.dbConfigured) throw new Error("unavailable");
        setSources(s.passages);
        setVersions(v.versions);
        setEvidenceState("ready");
      })
      .catch(() => {
        if (!cancelled) setEvidenceState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [sentence.id, sentence.version, retry]);

  useEffect(() => {
    onEditing(editing);
    if (editing) editor.current?.focus();
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    if (editing) window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      onEditing(false);
    };
  }, [editing, onEditing]);

  async function startEditing() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const lock = await api.acquireKb2SentenceLock(sentence.id, auditorId);
      if (!alive.current) {
        if (lock.ok) await api.releaseKb2SentenceLock(sentence.id, auditorId);
        return;
      }
      if (!lock.ok || !lock.dbConfigured) {
        setError(
          "다른 전문가가 수정 중이거나 연결할 수 없습니다. 잠시 후 다시 시도하세요.",
        );
        return;
      }
      hasLock.current = true;
      let recovered: string | null = null;
      try {
        recovered = sessionStorage.getItem(draftKey);
      } catch {
        /* Storage can be disabled. */
      }
      setDraft(recovered ?? sentence.content);
      if (recovered !== null)
        setNotice(
          "이 탭에 남아 있는 초안을 복원했습니다. 최신 문장과 비교한 후 저장하세요.",
        );
      setEditing(true);
    } catch {
      if (alive.current)
        setError(
          "편집을 시작하지 못했습니다. 연결을 확인하고 다시 시도하세요.",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  function updateDraft(value: string) {
    setDraft(value);
    try {
      sessionStorage.setItem(draftKey, value);
    } catch {
      setNotice(
        "이 브라우저에서는 초안 복구를 사용할 수 없습니다. 이동하기 전에 초안을 복사하세요.",
      );
    }
  }

  async function finish(save: boolean) {
    if (
      !save &&
      draft !== sentence.content &&
      !window.confirm("작성한 초안을 버릴까요?")
    )
      return;
    setBusy(true);
    setError("");
    try {
      if (save) {
        // Reacquire before every save: server leases expire after five minutes.
        const lock = await api.acquireKb2SentenceLock(sentence.id, auditorId);
        if (!lock.ok || !lock.dbConfigured) throw new Error("lock");
        hasLock.current = true;
        const result = await api.updateKb2Sentence(
          sentence.id,
          draft.trim(),
          auditorId,
          sentence.version,
        );
        if (!result.sentence || !result.dbConfigured) throw new Error("save");
        onSaved(result.sentence);
        hasLock.current = false; // Successful PATCH releases the server lease.
        setNotice("저장했습니다. 전문가 수정 내용은 재합성에서도 보호됩니다.");
      } else {
        await api.releaseKb2SentenceLock(sentence.id, auditorId);
        hasLock.current = false;
        setNotice("수정을 취소했습니다.");
      }
      try {
        sessionStorage.removeItem(draftKey);
      } catch {
        /* In-memory draft still works. */
      }
      setEditing(false);
      requestAnimationFrame(() => editButton.current?.focus());
    } catch (failure) {
      if (failure instanceof Error && failure.message.includes("409")) {
        setError(
          "다른 수정으로 문장 버전이 변경되었습니다. 초안은 유지됩니다. 초안을 복사한 후 최신 문장을 다시 열어 비교해 주세요.",
        );
      } else
        setError(
          save
            ? "저장하지 못했습니다. 초안은 유지됩니다. 연결 또는 편집 잠금을 확인한 후 다시 저장하세요."
            : "편집 잠금을 해제하지 못했습니다. 초안은 유지됩니다. 다시 시도하세요.",
        );
      editor.current?.focus();
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return (
    <aside className={styles.inspector} aria-label="문장과 근거">
      <div className={styles.inspectorHeader}>
        <span>문장과 근거</span>
        <button onClick={onClose} aria-label="근거 패널 닫기" disabled={busy}>
          <X size={18} />
        </button>
      </div>
      <div className={styles.inspectorBody}>
        <div className={styles.metadata}>
          <span>버전 {sentence.version}</span>
          <span>
            {new Date(sentence.updatedAt).toLocaleDateString("ko-KR")}
          </span>
        </div>
        <h2 ref={heading} tabIndex={-1} className={styles.statementHeading}>
          선택한 문장
        </h2>
        {editing ? (
          <>
            <label htmlFor="atlas-draft">문장 내용</label>
            <textarea
              id="atlas-draft"
              ref={editor}
              value={draft}
              onChange={(e) => updateDraft(e.target.value)}
              disabled={busy}
              rows={8}
            />
            <div className={styles.editActions}>
              <button
                className={styles.primary}
                onClick={() => void finish(true)}
                disabled={busy || !draft.trim()}
              >
                {busy ? "처리 중…" : error ? "다시 저장" : "저장"}
              </button>
              <button onClick={() => void finish(false)} disabled={busy}>
                취소
              </button>
              <button
                onClick={() => {
                  void navigator.clipboard
                    .writeText(draft)
                    .then(() => setNotice("초안을 복사했습니다."))
                    .catch(() =>
                      setNotice(
                        "자동 복사가 차단되었습니다. 문장 내용을 선택해 복사하세요.",
                      ),
                    );
                }}
              >
                <Copy size={15} /> 초안 복사
              </button>
            </div>
          </>
        ) : (
          <>
            <p className={styles.statement}>{sentence.content}</p>
            <button
              ref={editButton}
              onClick={() => void startEditing()}
              disabled={
                busy ||
                sentence.status !== "active" ||
                (sentence.effectivelyLocked && sentence.lockedBy !== auditorId)
              }
            >
              <Pencil size={15} /> 문장 수정
            </button>
          </>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className={styles.notice}>
            <Check size={16} />
            {notice}
          </p>
        )}
        {sentence.status === "retired" && (
          <p className={styles.notice}>
            연결이 끊긴 문장입니다. 검색에 포함되지 않습니다.
          </p>
        )}
        {sentence.effectivelyLocked && sentence.lockedBy !== auditorId && (
          <p className={styles.notice}>다른 전문가가 수정 중입니다.</p>
        )}
        {sentence.lockedByAuditor && (
          <p className={styles.protected}>
            <ShieldCheck size={16} /> 전문가 수정 · 재합성에서 보호
          </p>
        )}
        {sentence.attribution.length > 0 && (
          <details className={styles.attribution}>
            <summary>출처 기여자 {sentence.attribution.length}명</summary>
            <p>원문 기여 비율이며, 문장의 정확도나 신뢰도 점수가 아닙니다.</p>
            {sentence.attribution.map((a) => (
              <p key={a.auditorId}>
                {a.auditorId} <strong>{Math.round(a.weight * 100)}%</strong>
              </p>
            ))}
          </details>
        )}
        <div className={styles.tabs} aria-label="근거 보기">
          <button
            aria-pressed={tab === "sources"}
            onClick={() => setTab("sources")}
          >
            출처 {sentence.sourcePassageIds.length}
          </button>
          <button
            aria-pressed={tab === "history"}
            onClick={() => setTab("history")}
          >
            수정 이력
          </button>
        </div>
        {evidenceState === "loading" ? (
          <p role="status">근거를 불러오는 중…</p>
        ) : evidenceState === "error" ? (
          <div role="alert">
            <p>근거를 불러오지 못했습니다.</p>
            <button
              onClick={() => {
                setEvidenceState("loading");
                setRetry((n) => n + 1);
              }}
            >
              다시 불러오기
            </button>
          </div>
        ) : tab === "sources" ? (
          <>
            <p className={styles.explanation}>
              이 문장을 구성할 때 참조한 원문입니다.
            </p>
            {sources.length === 0 && <p>연결된 원문이 없습니다.</p>}
            {sources.map((source, i) => (
              <article key={source.id} className={styles.source}>
                <div className={styles.sourceTitle}>
                  <ArrowUpRight size={16} /> 출처 {i + 1}
                </div>
                <p>{source.content}</p>
                <footer>
                  {source.taxCategory}
                  {source.taxCategory && source.auditorId ? " · " : ""}
                  {source.auditorId}
                </footer>
              </article>
            ))}
          </>
        ) : (
          <>
            {versions.length === 0 && <p>아직 수정 이력이 없습니다.</p>}
            {versions.map((v) => (
              <article key={v.id} className={styles.source}>
                <div className={styles.sourceTitle}>
                  버전 {v.versionNo} · {versionLabels[v.editorType]}
                </div>
                <p>{v.content}</p>
                <footer>{new Date(v.createdAt).toLocaleString("ko-KR")}</footer>
              </article>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
