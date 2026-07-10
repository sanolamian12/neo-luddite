"use client";

import Link from "next/link";
import { useKbDocuments } from "@/lib/load-kb-seeds";
import { useKbHydrated } from "@/lib/kb-store";
import { DocumentReader } from "./document-reader";

/**
 * 리더 페이지의 클라이언트 래퍼. 시드 + user 문서 통합 조회.
 * 하이드레이션 완료 전에는 시드 후보(빠른 표시) → user 문서로 즉시 갱신.
 */
export function ClientDocumentView({ path }: { path: string }) {
  const hydrated = useKbHydrated();
  const docs = useKbDocuments();
  const doc = docs.find((d) => d.path === path);

  if (!doc) {
    if (!hydrated) {
      return (
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-6 py-10 text-sm text-muted-foreground">
            문서를 불러오는 중…
          </div>
        </div>
      );
    }
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-10">
          <h1 className="text-xl font-bold">문서를 찾을 수 없습니다</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            경로 <code className="break-all font-mono">{path}</code> 에 해당하는 문서가
            KB에 없습니다.
          </p>
          <Link
            href="/audit/knowledge"
            className="mt-4 inline-block text-sm underline underline-offset-2"
          >
            ← 마스터로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

  return <DocumentReader doc={doc} />;
}
