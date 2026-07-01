"use client";

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import {
  KB_CATEGORY_LABELS,
  type KbDocument,
} from "@/lib/kb-schema";
import { useKbDocuments } from "@/lib/load-kb-seeds";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * KB 첨부 피커.
 * - 텍스트 검색(제목·경로·태그 부분일치)
 * - 결과 드롭다운에서 클릭하면 선택 목록에 추가
 * - 선택된 칩은 × 로 제거
 * - selected 는 KbDocument.id 배열(외래키). 부모가 상태 관리.
 */
export function KbPicker({
  selectedIds,
  onChange,
}: {
  selectedIds: string[];
  onChange: (next: string[]) => void;
}) {
  const docs = useKbDocuments();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedDocs = useMemo(
    () => selectedIds.map((id) => docs.find((d) => d.id === id) ?? id),
    [selectedIds, docs],
  );

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return docs
      .filter((d) => !selectedSet.has(d.id))
      .filter((d) => matches(d, q))
      .slice(0, 8);
  }, [docs, query, selectedSet]);

  const add = (id: string) => {
    onChange([...selectedIds, id]);
    setQuery("");
  };
  const remove = (id: string) =>
    onChange(selectedIds.filter((x) => x !== id));

  return (
    <div className="flex flex-col gap-1.5">
      {selectedDocs.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {selectedDocs.map((it) => {
            const isOrphan = typeof it === "string";
            const id = isOrphan ? it : it.id;
            const label = isOrphan
              ? "삭제된 문서"
              : it.frontmatter.title || it.path;
            return (
              <li key={id}>
                <Badge
                  variant={isOrphan ? "outline" : "secondary"}
                  className="gap-1 pr-1"
                >
                  <span className="max-w-[180px] truncate">{label}</span>
                  <button
                    type="button"
                    onClick={() => remove(id)}
                    aria-label="첨부 해제"
                    className="ml-0.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              </li>
            );
          })}
        </ul>
      )}

      <div className="relative">
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder="KB 문서 검색 (제목·경로·태그)"
          className="h-8 text-xs"
        />
        {open && candidates.length > 0 && (
          <ul className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
            {candidates.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    // onBlur 보다 먼저 발생하도록 mousedown 사용
                    e.preventDefault();
                    add(d.id);
                  }}
                  className={cn(
                    "flex w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left text-xs",
                    "hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <span className="flex items-center gap-1 font-medium">
                    <Plus className="size-3 opacity-60" />
                    {d.frontmatter.title}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {KB_CATEGORY_LABELS[d.category]} · {d.path}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function matches(doc: KbDocument, q: string): boolean {
  if (doc.frontmatter.title.toLowerCase().includes(q)) return true;
  if (doc.path.toLowerCase().includes(q)) return true;
  if (doc.frontmatter.tags?.some((t) => t.toLowerCase().includes(q)))
    return true;
  return false;
}
