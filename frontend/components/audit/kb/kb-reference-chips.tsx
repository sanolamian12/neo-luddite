"use client";

import Link from "next/link";
import { kbHrefForPath } from "@/lib/kb-route";
import { useKbDocuments } from "@/lib/load-kb-seeds";
import { Badge } from "@/components/ui/badge";

/**
 * 라인 피드백 카드에서 첨부 KB 문서를 칩으로 표시 (읽기 전용).
 * 삭제된 문서(orphan)는 회색 outline 칩으로 알린다.
 */
export function KbReferenceChips({ ids }: { ids: string[] }) {
  const docs = useKbDocuments();
  if (ids.length === 0) return null;

  return (
    <ul className="mt-1.5 flex flex-wrap gap-1">
      {ids.map((id) => {
        const doc = docs.find((d) => d.id === id);
        if (!doc) {
          return (
            <li key={id}>
              <Badge
                variant="outline"
                className="text-[10px] text-muted-foreground line-through"
                title={`삭제된 문서 (${id})`}
              >
                삭제된 문서
              </Badge>
            </li>
          );
        }
        return (
          <li key={id}>
            <Link href={kbHrefForPath(doc.path)}>
              <Badge variant="secondary" className="text-[10px]">
                {doc.frontmatter.title}
              </Badge>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
