"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, FileText, Plus } from "lucide-react";
import { usePathname } from "next/navigation";
import type { KbDocument } from "@/lib/kb-schema";
import { folderLabel, pathLeaf } from "@/lib/kb-schema";
import { useKbDocuments } from "@/lib/load-kb-seeds";
import { KB_BASE, kbHrefForPath } from "@/lib/kb-route";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface FolderNode {
  name: string;
  fullPath: string; // 카테고리 폴더 포함
  children: Map<string, FolderNode>;
  documents: KbDocument[];
}

function emptyNode(name: string, fullPath: string): FolderNode {
  return { name, fullPath, children: new Map(), documents: [] };
}

function buildTree(docs: KbDocument[]): {
  root: FolderNode;
  master: KbDocument | null;
} {
  const root = emptyNode("", "");
  let master: KbDocument | null = null;

  for (const doc of docs) {
    if (doc.category === "skill-master") {
      master = doc;
      continue;
    }
    const segments = doc.path.split("/");
    const leaf = segments.pop()!;
    let cursor = root;
    let accum = "";
    for (const seg of segments) {
      accum = accum ? `${accum}/${seg}` : seg;
      if (!cursor.children.has(seg)) {
        cursor.children.set(seg, emptyNode(seg, accum));
      }
      cursor = cursor.children.get(seg)!;
    }
    cursor.documents.push({ ...doc, frontmatter: doc.frontmatter });
    // path leaf 변수는 frontmatter title 표시용으로 컴포넌트가 받음
    void leaf;
  }
  return { root, master };
}

/**
 * KB 사이드바 폴더 트리 — 시드 + user 문서 통합 노출.
 * 활성 path 는 현재 라우트(usePathname)에서 추출하여 디코딩 후 비교.
 */
export function FolderTree() {
  const docs = useKbDocuments();
  const pathname = usePathname();

  const activePath = useMemo(() => {
    if (!pathname.startsWith(KB_BASE)) return null;
    const rest = pathname.slice(KB_BASE.length).replace(/^\//, "");
    if (!rest) return null;
    try {
      return decodeURIComponent(rest);
    } catch {
      return rest;
    }
  }, [pathname]);

  const { root, master } = useMemo(() => buildTree(docs), [docs]);

  return (
    <nav aria-label="지식 베이스 트리" className="px-2 text-sm">
      {master && (
        <ul className="mb-2">
          <DocumentRow
            doc={master}
            active={activePath === master.path}
            depth={0}
          />
        </ul>
      )}
      <ul className="flex flex-col gap-0.5">
        {[...root.children.values()].map((child) => (
          <FolderRow key={child.fullPath} node={child} activePath={activePath} />
        ))}
      </ul>
      <div className="mt-2 border-t pt-2">
        <Link
          href="/audit/knowledge/new"
          className={cn(
            "flex items-center gap-1 rounded-sm px-1.5 py-1 text-xs",
            "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Plus className="size-3.5" />
          <span>새 문서</span>
        </Link>
      </div>
    </nav>
  );
}

function FolderRow({
  node,
  activePath,
  depth = 0,
}: {
  node: FolderNode;
  activePath: string | null;
  depth?: number;
}) {
  const initiallyOpen =
    depth < 1 ||
    (activePath != null &&
      (activePath === node.fullPath || activePath.startsWith(`${node.fullPath}/`)));
  const [open, setOpen] = useState(initiallyOpen);

  const userCount = node.documents.filter((d) => d.source === "user").length;
  const totalDocs = countDocuments(node);

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center gap-1 rounded-sm px-1.5 py-1 text-left text-xs font-medium text-muted-foreground transition",
          "hover:bg-muted hover:text-foreground",
        )}
        style={{ paddingLeft: 4 + depth * 12 }}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="size-3.5" />
        ) : (
          <ChevronRight className="size-3.5" />
        )}
        <span className="flex-1 truncate">{folderLabel(node.name)}</span>
        {userCount > 0 && (
          <Badge variant="secondary" className="text-[10px]">
            {userCount}
          </Badge>
        )}
        {userCount === 0 && totalDocs > 0 && (
          <span className="text-[10px] text-muted-foreground/60">
            {totalDocs}
          </span>
        )}
      </button>
      {open && (
        <ul className="flex flex-col gap-0.5">
          {[...node.children.values()].map((child) => (
            <FolderRow
              key={child.fullPath}
              node={child}
              activePath={activePath}
              depth={depth + 1}
            />
          ))}
          {node.documents.map((d) => (
            <DocumentRow
              key={d.id}
              doc={d}
              active={activePath === d.path}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function DocumentRow({
  doc,
  active,
  depth,
}: {
  doc: KbDocument;
  active: boolean;
  depth: number;
}) {
  const href = doc.category === "skill-master" ? KB_BASE : kbHrefForPath(doc.path);
  const label = doc.frontmatter.title || pathLeaf(doc.path);
  return (
    <li>
      <Link
        href={href}
        className={cn(
          "flex items-center gap-1 rounded-sm px-1.5 py-1 text-xs",
          active
            ? "bg-foreground/5 font-medium text-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
        style={{ paddingLeft: 4 + depth * 12 + 14 }}
      >
        <FileText className="size-3.5 shrink-0 opacity-70" />
        <span className="line-clamp-1 flex-1">{label}</span>
        {doc.source === "user" && (
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full bg-brand-green"
            title="사용자 문서"
          />
        )}
      </Link>
    </li>
  );
}

function countDocuments(node: FolderNode): number {
  let n = node.documents.length;
  for (const c of node.children.values()) n += countDocuments(c);
  return n;
}
