"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Bot, HelpCircle, Pencil, RefreshCw, Stamp, Tag } from "lucide-react";
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
import { formatDateTime } from "@/lib/poc-format";
import { useAccountStore } from "@/lib/account-store";
import { FEEDBACK_TAGS, FEEDBACK_TAG_LABELS, type FeedbackTag } from "@/lib/audit-schema";
import { contributionUnits, nodeKeywords, nodeRadius } from "@/lib/kb-node-visual";
import { answerDisplay, parseBundleContent, parseTagsLine } from "@/lib/kb-passage-text";
import * as ragService from "@/services/rag";
import type { PassageEdit, PassageInfo, PassageNeighbor } from "@/services/rag";

/**
 * KB 지식망 상세뷰 — passage 하나를 중심에 두고, 조회 시점에 계산한 코사인 유사도 이웃을
 * 방사형(거미줄)으로 펼친다. 저장된 그래프가 아니라 "지금 이 passage 와 가장 가까운 것"을
 * 매번 새로 재는 국소 그래프다(구조 분석 2026-08-27) — 전체를 한 번에 그리지 않아 KB 가
 * 커져도(exact scan) 비용이 늘지 않는다. 이웃을 클릭하면 그 이웃을 중심으로 다시 펼쳐져
 * 탐색형으로 KB 를 따라갈 수 있다.
 *
 * 화면 구성(2026-08-31 개편): 위쪽 1단은 본문(질문/AI 답변/세무사 코멘트 + 태그), 그
 * 아래 2단은 왼쪽 그래프·오른쪽 유사도 이웃 목록 — map 화면(전체 그래프)의 결을 그대로
 * 이어받아 "본문 먼저, 그 다음 관계"로 읽히게 했다.
 */

// build_bundle_text() 의 _TAG_LABELS(backend/api/rag/ingest.py) 와 문구를 맞춘 것 —
// content 안의 "(태그: …)" 줄은 이 라벨로 조립돼 있어 되짚을 때도 이 라벨을 써야 한다.
// 프론트 정식 라벨(FEEDBACK_TAG_LABELS)은 "제안사항"처럼 살짝 다를 수 있어 매칭은
// 이 라벨을 우선한다.
const BACKEND_TAG_LABELS: Record<FeedbackTag, string> = {
  legal_error: "법적 해석 오류",
  grammar_error: "문법적 오류",
  suggestion: "제안",
};

function codesFromTagLabels(labels: string[]): FeedbackTag[] {
  return FEEDBACK_TAGS.filter((code) =>
    labels.some((l) => l === BACKEND_TAG_LABELS[code] || l === FEEDBACK_TAG_LABELS[code]),
  );
}

function contentWithTags(content: string, codes: FeedbackTag[]): string {
  const newLine = `(태그: ${codes.map((c) => BACKEND_TAG_LABELS[c]).join(", ")})`;
  const lines = content.split("\n");
  const idx = lines.findIndex((l) => /^\(태그:\s*.+\)$/.test(l.trim()));
  if (idx >= 0) lines[idx] = newLine;
  else lines.push(newLine);
  return lines.join("\n");
}

const CENTER = 260;
const MIN_R = 90;
const MAX_R = 220;

function radiusFor(score: number): number {
  const clamped = Math.min(1, Math.max(0, score));
  return MIN_R + (1 - clamped) * (MAX_R - MIN_R);
}

/** 노드 라벨용 핵심 단어를 제목으로 — 없으면 "유사도 이웃"으로 폴백. */
function titleFor(content: string): string {
  const words = nodeKeywords(content, 4);
  return words.length > 0 ? words.join(", ") : "유사도 이웃";
}

function TagEditDialog({
  open,
  onOpenChange,
  initialCodes,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialCodes: FeedbackTag[];
  onSubmit: (codes: FeedbackTag[]) => void;
  submitting: boolean;
}) {
  const [selected, setSelected] = useState<FeedbackTag[]>(initialCodes);

  useEffect(() => {
    if (open) setSelected(initialCodes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (code: FeedbackTag) => {
    setSelected((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  };

  const changed =
    selected.length !== initialCodes.length || selected.some((c) => !initialCodes.includes(c));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            <Tag className="size-4" />
            태그 수정 제안
          </DialogTitle>
          <DialogDescription>
            이 항목에 붙은 분류 태그를 바꿔 admin 승인 요청을 올립니다. 승인 전까지 원문 태그는
            그대로 검색됩니다.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          {FEEDBACK_TAGS.map((code) => {
            const active = selected.includes(code);
            return (
              <button
                key={code}
                type="button"
                onClick={() => toggle(code)}
                className={
                  active
                    ? "rounded-full border border-brand-green bg-brand-green/20 px-3 py-1.5 text-sm font-medium text-foreground transition-colors"
                    : "rounded-full border border-border bg-muted/30 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-brand-green/50"
                }
              >
                {FEEDBACK_TAG_LABELS[code]}
              </button>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            취소
          </Button>
          <Button
            onClick={() => onSubmit(selected)}
            disabled={submitting || selected.length === 0 || !changed}
          >
            수정 제안 제출
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function KbPassageDetailView({ passageId }: { passageId: string }) {
  const router = useRouter();
  const auditorId = useAccountStore((s) => s.auditor.id);
  const reviewerName = useAccountStore((s) => s.auditor.reviewerName);
  const [center, setCenter] = useState<PassageInfo | null | undefined>(undefined);
  const [neighbors, setNeighbors] = useState<PassageNeighbor[] | null>(null);
  const [pendingEdit, setPendingEdit] = useState<PassageEdit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hovered, setHovered] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [all, nb, edits] = await Promise.all([
        ragService.listPassages(),
        ragService.getPassageNeighbors(passageId, 8),
        ragService.listEdits({ status: "pending", passageId }),
      ]);
      setCenter(all.find((p) => p.id === passageId) ?? null);
      setNeighbors(nb.neighbors);
      setPendingEdit(edits.edits[0] ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setNeighbors([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    setEditing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passageId]);

  const startEdit = () => {
    setDraft(center?.content ?? "");
    setEditing(true);
  };

  const submitEdit = async () => {
    if (!center || !draft.trim() || draft.trim() === center.content.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await ragService.proposeEdit(center.id, draft.trim(), auditorId, reviewerName);
      setEditing(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const submitTagEdit = async (codes: FeedbackTag[]) => {
    if (!center) return;
    setSubmitting(true);
    setError(null);
    try {
      await ragService.proposeEdit(center.id, contentWithTags(center.content, codes), auditorId, reviewerName);
      setTagDialogOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const { question, answer, comment } = center ? parseBundleContent(center.content) : { question: "", answer: "", comment: "" };
  const tagLabels = center ? parseTagsLine(center.content) : null;
  const tagCodes = useMemo(() => (tagLabels ? codesFromTagLabels(tagLabels) : []), [tagLabels]);
  const canEditTags = !!tagLabels && !editing && !pendingEdit;

  return (
    <div className="flex flex-col gap-5 px-6 py-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <Link
            href="/audit/kb-map"
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
          >
            <ArrowLeft className="size-3" />
            지식망으로
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">
            {center ? titleFor(center.content) : "유사도 이웃"}
          </h1>
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

      {loading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">로딩 중…</p>
      ) : center === null ? (
        <p className="rounded-xl border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
          이 passage 를 찾을 수 없습니다(연결끊김/삭제됐을 수 있음).
        </p>
      ) : (
        center && (
          <>
            {/* 1단 — 본문 */}
            <section className="rounded-xl border border-brand-amber/40 bg-card p-4">
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="text-[10px]">{center.sourceKind}</Badge>
                {center.taxCategory && <Badge variant="secondary" className="text-[10px]">{center.taxCategory}</Badge>}
                {center.occupation && <Badge variant="secondary" className="text-[10px]">{center.occupation}</Badge>}
                {center.status === "retired" && <Badge variant="destructive" className="text-[10px]">연결끊김</Badge>}
                <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(center.createdAt)}</span>
              </div>

              {editing ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    className="min-h-[140px] w-full rounded-md border bg-background p-2 text-sm"
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
                      onClick={() => void submitEdit()}
                      disabled={submitting || !draft.trim() || draft.trim() === center.content.trim()}
                    >
                      수정 제안 제출
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex gap-2.5 rounded-lg bg-muted/30 px-3 py-2.5">
                    <HelpCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-muted-foreground">질문</p>
                      <p className="whitespace-pre-wrap text-sm text-foreground">{question || "—"}</p>
                    </div>
                  </div>
                  <div className="flex gap-2.5 rounded-lg bg-muted/30 px-3 py-2.5">
                    <Bot className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-muted-foreground">AI 답변</p>
                      <p className="whitespace-pre-wrap text-sm text-foreground">
                        {answer ? answer : (
                          <span className="italic text-muted-foreground">
                            {answerDisplay(center.sourceKind, answer)}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2.5 rounded-lg bg-brand-green/10 px-3 py-2.5">
                    <Stamp className="mt-0.5 size-4 shrink-0 text-brand-green" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-brand-green">세무사 코멘트</p>
                      <p className="whitespace-pre-wrap text-sm text-foreground">{comment || "—"}</p>
                    </div>
                  </div>

                  {tagLabels && tagLabels.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pl-1">
                      <Tag className="size-3.5 text-muted-foreground" />
                      {tagLabels.map((label) => (
                        <button
                          key={label}
                          type="button"
                          disabled={!canEditTags}
                          onClick={() => setTagDialogOpen(true)}
                          className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground transition-colors enabled:hover:border-brand-green enabled:hover:bg-brand-green/10 disabled:cursor-default disabled:opacity-70"
                          title={canEditTags ? "클릭해서 태그 수정 제안" : undefined}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <p className="mt-3 text-xs text-muted-foreground">{center.reviewer ?? center.auditorId ?? "—"}</p>

              {pendingEdit ? (
                <div className="mt-3 rounded-md border border-dashed border-brand-amber/50 bg-brand-amber/5 px-3 py-2 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">
                    대기 중인 수정 제안 — {pendingEdit.editorReviewer ?? pendingEdit.editorAuditorId} ·{" "}
                    {formatDateTime(pendingEdit.createdAt)}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{pendingEdit.proposedContent}</p>
                  <p className="mt-1">admin 승인 대기 중 — 승인 전까지 원문은 그대로 검색됩니다.</p>
                </div>
              ) : (
                !editing && (
                  <Button size="sm" variant="outline" className="mt-3" onClick={startEdit}>
                    <Pencil className="size-3.5" />
                    수정 제안
                  </Button>
                )
              )}
              <p className="mt-1 text-[11px] text-muted-foreground">
                수정이 승인돼도 이 항목의 존속기간 기여는 원작성자({center.reviewer ?? center.auditorId ?? "—"})
                에게 그대로 남습니다 — 수정은 이력으로만 기록됩니다.
              </p>
            </section>

            <TagEditDialog
              open={tagDialogOpen}
              onOpenChange={setTagDialogOpen}
              initialCodes={tagCodes}
              onSubmit={(codes) => void submitTagEdit(codes)}
              submitting={submitting}
            />

            {/* 유사도 이웃 섹션 제목 — 본문과 2단 사이 */}
            <div>
              <h2 className="text-lg font-semibold tracking-tight">유사도 이웃</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                이 항목과 지금 KB 안에서 가장 유사한 항목들입니다(코사인 유사도, 조회 시점 계산).
                이웃을 클릭하면 그 이웃을 중심으로 다시 펼쳐집니다.
              </p>
            </div>

            {/* 2단 — 왼쪽 그래프(최대한 크게) / 오른쪽 유사도 이웃 목록 */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch">
              <div className="flex items-center justify-center rounded-xl border bg-card p-2">
                <svg viewBox="0 0 520 520" className="mx-auto w-full" role="img" aria-label="유사도 네트워크">
                  {(neighbors ?? []).map((n) => {
                    const idx = (neighbors ?? []).indexOf(n);
                    const total = (neighbors ?? []).length || 1;
                    const angle = (idx / total) * Math.PI * 2 - Math.PI / 2;
                    const r = radiusFor(n.score);
                    const x = CENTER + r * Math.cos(angle);
                    const y = CENTER + r * Math.sin(angle);
                    const isHovered = hovered === n.id;
                    const nr = nodeRadius(contributionUnits(n.content)) + (isHovered ? 4 : 0);
                    const keywords = nodeKeywords(n.content);
                    return (
                      <g key={n.id}>
                        <line
                          x1={CENTER}
                          y1={CENTER}
                          x2={x}
                          y2={y}
                          stroke="currentColor"
                          strokeOpacity={0.15 + n.score * 0.35}
                          strokeWidth={isHovered ? 2 : 1}
                          className="text-brand-green"
                        />
                        <g
                          className="cursor-pointer"
                          onMouseEnter={() => setHovered(n.id)}
                          onMouseLeave={() => setHovered((h) => (h === n.id ? null : h))}
                          onClick={() => router.push(`/audit/kb-map/${encodeURIComponent(n.id)}`)}
                        >
                          <circle
                            cx={x}
                            cy={y}
                            r={nr}
                            className="fill-brand-green/80 stroke-background transition-all"
                            strokeWidth={2}
                          />
                          <text
                            x={x}
                            y={y + 1}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            className="fill-background text-[10px] font-semibold"
                          >
                            {Math.round(n.score * 100)}%
                          </text>
                          {keywords.length > 0 && (
                            <text
                              x={x}
                              y={y + nr + 13}
                              textAnchor="middle"
                              className={
                                isHovered
                                  ? "fill-foreground text-[9px] font-medium"
                                  : "fill-muted-foreground text-[9px]"
                              }
                            >
                              {keywords.join(" · ")}
                            </text>
                          )}
                        </g>
                      </g>
                    );
                  })}
                  {/* 중심 노드 */}
                  <circle cx={CENTER} cy={CENTER} r={22} className="fill-brand-amber stroke-background" strokeWidth={3} />
                  <text x={CENTER} y={CENTER + 4} textAnchor="middle" className="fill-background text-[11px] font-bold">
                    중심
                  </text>
                </svg>
                {(neighbors ?? []).length === 0 && (
                  <p className="px-3 py-2 text-center text-xs text-muted-foreground">
                    유사한 다른 항목이 아직 없습니다.
                  </p>
                )}
              </div>

              <section className="rounded-xl border bg-card">
                <header className="border-b px-4 py-2 text-sm font-semibold">
                  이웃 목록 {neighbors ? `(${neighbors.length})` : ""}
                </header>
                <ul className="divide-y">
                  {(neighbors ?? [])
                    .slice()
                    .sort((a, b) => b.score - a.score)
                    .map((n) => (
                      <li key={n.id}>
                        <Link
                          href={`/audit/kb-map/${encodeURIComponent(n.id)}`}
                          onMouseEnter={() => setHovered(n.id)}
                          onMouseLeave={() => setHovered((h) => (h === n.id ? null : h))}
                          className={
                            hovered === n.id
                              ? "flex flex-col gap-1 border-l-2 border-brand-green bg-brand-green/15 px-4 py-2.5"
                              : "flex flex-col gap-1 border-l-2 border-transparent px-4 py-2.5 hover:bg-muted/30"
                          }
                        >
                          <div className="flex items-center gap-2">
                            <Badge variant="default" className="text-[10px]">
                              {Math.round(n.score * 100)}%
                            </Badge>
                            <Badge variant="outline" className="text-[10px]">{n.sourceKind}</Badge>
                            {n.taxCategory && <span className="text-xs text-muted-foreground">{n.taxCategory}</span>}
                          </div>
                          <p className="line-clamp-1 text-sm">{n.content}</p>
                        </Link>
                      </li>
                    ))}
                </ul>
              </section>
            </div>
          </>
        )
      )}
    </div>
  );
}
