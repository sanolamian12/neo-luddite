"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import type {
  KbCategory,
  KbCitation,
  KbDocument,
  KbFrontmatter,
} from "@/lib/kb-schema";
import {
  KB_CATEGORIES,
  KB_CATEGORY_LABELS,
} from "@/lib/kb-schema";
import { useKbStore } from "@/lib/kb-store";
import { useAccountStore } from "@/lib/account-store";
import { kbHrefForPath } from "@/lib/kb-route";
import { buildCandidatePath } from "@/lib/kb-utils";
import { OCCUPATIONS } from "@/lib/occupations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { KbMarkdown } from "./markdown-render";
import { cn } from "@/lib/utils";

/** 신규 작성에서 선택 가능한 카테고리(마스터는 제외). */
const SELECTABLE_CATEGORIES = KB_CATEGORIES.filter(
  (c) => c !== "skill-master",
) as Exclude<KbCategory, "skill-master">[];

interface DocumentEditorProps {
  mode: "new" | "edit";
  existing?: KbDocument;
  initialCategory?: KbCategory;
}

interface FormState {
  category: Exclude<KbCategory, "skill-master">;
  frontmatter: KbFrontmatter;
  body: string;
  citations: KbCitation[];
}

function initialState(props: DocumentEditorProps): FormState {
  if (props.mode === "edit" && props.existing) {
    return {
      category: props.existing.category as FormState["category"],
      frontmatter: { ...props.existing.frontmatter },
      body: props.existing.body,
      citations: [...props.existing.citations],
    };
  }
  const cat =
    (props.initialCategory as FormState["category"]) ??
    "interpretation-framework";
  return {
    category: cat,
    frontmatter: { title: "", summary: "", tags: [] },
    body: "",
    citations: [],
  };
}

export function DocumentEditor(props: DocumentEditorProps) {
  const router = useRouter();
  const reviewerName = useAccountStore((s) => s.auditor.reviewerName);
  const createNew = useKbStore((s) => s.createNew);
  const upsert = useKbStore((s) => s.upsert);

  const [state, setState] = useState<FormState>(() => initialState(props));
  const [tagDraft, setTagDraft] = useState("");

  const candidatePath = useMemo(() => {
    if (props.mode === "edit" && props.existing) return props.existing.path;
    return buildCandidatePath(state.category, state.frontmatter);
  }, [props.mode, props.existing, state.category, state.frontmatter]);

  const canSave = state.frontmatter.title.trim().length > 0;

  const updateFm = (patch: Partial<KbFrontmatter>) =>
    setState((s) => ({
      ...s,
      frontmatter: { ...s.frontmatter, ...patch },
    }));

  const submit = (status: "draft" | "published") => {
    if (!canSave) return;
    const fm: KbFrontmatter = {
      ...state.frontmatter,
      title: state.frontmatter.title.trim(),
      summary: state.frontmatter.summary?.trim() || undefined,
      tags: (state.frontmatter.tags ?? []).filter(Boolean),
    };

    if (props.mode === "edit" && props.existing) {
      upsert({
        ...props.existing,
        category: state.category,
        frontmatter: fm,
        body: state.body,
        citations: state.citations,
        status,
        reviewer: reviewerName,
      });
      router.push(kbHrefForPath(props.existing.path));
      return;
    }

    const doc = createNew({
      category: state.category,
      frontmatter: fm,
      body: state.body,
      citations: state.citations,
      reviewer: reviewerName,
      status,
    });
    router.push(kbHrefForPath(doc.path));
  };

  const cancel = () => {
    if (props.mode === "edit" && props.existing) {
      router.push(kbHrefForPath(props.existing.path));
    } else {
      router.push("/audit/knowledge");
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="shrink-0 border-b bg-background/95 px-6 py-3 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-bold">
              {props.mode === "new" ? "새 문서" : "문서 편집"}
            </h1>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              경로: <code className="font-mono">{candidatePath || "—"}</code>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 md:shrink-0">
            <Button variant="ghost" size="sm" onClick={cancel}>
              취소
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!canSave}
              onClick={() => submit("draft")}
            >
              초안 저장
            </Button>
            <Button
              size="sm"
              disabled={!canSave}
              onClick={() => submit("published")}
            >
              발행
            </Button>
          </div>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="카테고리">
          <CategorySelect
            value={state.category}
            disabled={props.mode === "edit"}
            onChange={(c) => setState((s) => ({ ...s, category: c }))}
          />
        </Field>

        <Field label="제목 *">
          <Input
            value={state.frontmatter.title}
            onChange={(e) => updateFm({ title: e.target.value })}
            placeholder="문서 제목"
          />
        </Field>

        <Field label="요약" className="md:col-span-2">
          <Input
            value={state.frontmatter.summary ?? ""}
            onChange={(e) => updateFm({ summary: e.target.value })}
            placeholder="한두 문장 요약"
          />
        </Field>

        {state.category === "occupation" && (
          <Field label="직업군">
            <select
              value={state.frontmatter.occupation ?? OCCUPATIONS[0]?.key ?? ""}
              onChange={(e) => updateFm({ occupation: e.target.value })}
              className={cn(
                "h-9 rounded-md border bg-background px-2 text-sm outline-none",
                "focus-visible:ring-2 focus-visible:ring-brand-blue",
              )}
            >
              {OCCUPATIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.emoji} {o.label} ({o.key})
                </option>
              ))}
            </select>
          </Field>
        )}

        {state.category === "case-precedent" && (
          <Field label="케이스 ID">
            <Input
              value={state.frontmatter.caseId ?? ""}
              onChange={(e) => updateFm({ caseId: e.target.value })}
              placeholder="예: 조심2025구1960 (URL slug 은 자동 생성)"
            />
          </Field>
        )}

        {state.category === "interpretation-framework" && (
          <Field label="프레임워크">
            <Input
              value={state.frontmatter.framework ?? ""}
              onChange={(e) => updateFm({ framework: e.target.value })}
              placeholder="예: 엄격해석"
            />
          </Field>
        )}

        <Field label="태그" className="md:col-span-2">
          <TagsInput
            tags={state.frontmatter.tags ?? []}
            draft={tagDraft}
            onDraftChange={setTagDraft}
            onAdd={(t) =>
              updateFm({ tags: [...(state.frontmatter.tags ?? []), t] })
            }
            onRemove={(idx) =>
              updateFm({
                tags: (state.frontmatter.tags ?? []).filter((_, i) => i !== idx),
              })
            }
          />
        </Field>
      </section>

      <section>
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          인용
        </h2>
        <CitationsEditor
          citations={state.citations}
          onChange={(citations) => setState((s) => ({ ...s, citations }))}
        />
      </section>

      <section>
        <MarkdownEditor
          value={state.body}
          onChange={(body) => setState((s) => ({ ...s, body }))}
          preview={<KbMarkdown body={state.body || "_(본문이 비어 있습니다)_"} />}
        />
        <p className="mt-2 text-[11px] text-muted-foreground">
          본문에서 <code>[[경로]]</code> 표기로 다른 KB 문서를 참조할 수 있습니다.
        </p>
      </section>
        </div>
      </div>
    </div>
  );
}

// ── 폼 보조 컴포넌트 ────────────────────────────────────────────────────────────

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function CategorySelect({
  value,
  onChange,
  disabled,
}: {
  value: FormState["category"];
  onChange: (c: FormState["category"]) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as FormState["category"])}
      disabled={disabled}
      className={cn(
        "h-9 rounded-md border bg-background px-2 text-sm outline-none",
        "focus-visible:ring-2 focus-visible:ring-brand-blue",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      {SELECTABLE_CATEGORIES.map((c) => (
        <option key={c} value={c}>
          {KB_CATEGORY_LABELS[c]}
        </option>
      ))}
    </select>
  );
}

function TagsInput({
  tags,
  draft,
  onDraftChange,
  onAdd,
  onRemove,
}: {
  tags: string[];
  draft: string;
  onDraftChange: (v: string) => void;
  onAdd: (tag: string) => void;
  onRemove: (idx: number) => void;
}) {
  const commit = () => {
    const t = draft.trim();
    if (!t) return;
    if (tags.includes(t)) {
      onDraftChange("");
      return;
    }
    onAdd(t);
    onDraftChange("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5">
      {tags.map((t, i) => (
        <Badge key={`${t}-${i}`} variant="secondary" className="gap-1 pr-1">
          #{t}
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="ml-0.5 text-muted-foreground hover:text-foreground"
            aria-label="태그 삭제"
          >
            ×
          </button>
        </Badge>
      ))}
      <input
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
        placeholder={tags.length === 0 ? "태그 추가 후 Enter" : ""}
        className="flex-1 bg-transparent px-1 text-sm outline-none"
      />
    </div>
  );
}

function CitationsEditor({
  citations,
  onChange,
}: {
  citations: KbCitation[];
  onChange: (next: KbCitation[]) => void;
}) {
  const add = () =>
    onChange([...citations, { kind: "case", caseId: "" }]);
  const remove = (idx: number) =>
    onChange(citations.filter((_, i) => i !== idx));
  const patch = (idx: number, next: KbCitation) =>
    onChange(citations.map((c, i) => (i === idx ? next : c)));

  return (
    <div className="flex flex-col gap-2">
      {citations.map((c, idx) => (
        <CitationRow
          key={idx}
          citation={c}
          onChange={(next) => patch(idx, next)}
          onRemove={() => remove(idx)}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        className="self-start"
      >
        <Plus className="size-3.5" />
        인용 추가
      </Button>
    </div>
  );
}

function CitationRow({
  citation,
  onChange,
  onRemove,
}: {
  citation: KbCitation;
  onChange: (next: KbCitation) => void;
  onRemove: () => void;
}) {
  const kind = citation.kind;
  const setKind = (k: KbCitation["kind"]) => {
    if (k === "case") onChange({ kind: "case", caseId: "" });
    else if (k === "law") onChange({ kind: "law", ref: "" });
    else onChange({ kind: "external", url: "https://", label: "" });
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-card px-2 py-1.5 md:flex-row md:items-center">
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value as KbCitation["kind"])}
        className="h-8 rounded-md border bg-background px-1.5 text-xs"
      >
        <option value="case">케이스</option>
        <option value="law">법령</option>
        <option value="external">외부</option>
      </select>

      {citation.kind === "case" && (
        <Input
          value={citation.caseId}
          onChange={(e) =>
            onChange({ ...citation, caseId: e.target.value })
          }
          placeholder="예: 조심2025구1960"
          className="h-8"
        />
      )}

      {citation.kind === "law" && (
        <Input
          value={citation.ref}
          onChange={(e) => onChange({ ...citation, ref: e.target.value })}
          placeholder="예: 소득세법 §78의3"
          className="h-8"
        />
      )}

      {citation.kind === "external" && (
        <>
          <Input
            value={citation.url}
            onChange={(e) => onChange({ ...citation, url: e.target.value })}
            placeholder="https://…"
            className="h-8 flex-1"
          />
          <Input
            value={citation.label}
            onChange={(e) => onChange({ ...citation, label: e.target.value })}
            placeholder="라벨"
            className="h-8 w-full md:w-32"
          />
        </>
      )}

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onRemove}
        aria-label="인용 삭제"
      >
        <Trash2 />
      </Button>
    </div>
  );
}
