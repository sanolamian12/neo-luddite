"use client";

import Link from "next/link";
import { useKbHydrated, useKbStore } from "@/lib/kb-store";
import { getKbSeedByPath } from "@/lib/kb-seeds";
import { kbHrefForPath } from "@/lib/kb-route";
import { DocumentEditor } from "./document-editor";

/**
 * 편집 라우트의 클라이언트 게이트.
 * - user 문서면 에디터 노출.
 * - 시드 path 면 에디터 차단(읽기 전용 안내).
 * - 둘 다 아니면 404.
 */
export function ClientEditView({ path }: { path: string }) {
  const hydrated = useKbHydrated();
  const userDoc = useKbStore((s) =>
    s.documents.find((d) => d.path === path),
  );
  const seedDoc = getKbSeedByPath(path);

  if (userDoc) {
    return <DocumentEditor mode="edit" existing={userDoc} />;
  }

  if (seedDoc) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-10">
          <h1 className="text-xl font-bold">시드 문서는 편집할 수 없습니다</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            <code className="font-mono">{path}</code> 는 시드 문서입니다.
            편집하려면 "이 문서를 확장" 버튼으로 사용자 사본을 만드세요.
          </p>
          <Link
            href={kbHrefForPath(path)}
            className="mt-4 inline-block text-sm underline underline-offset-2"
          >
            ← 시드 문서로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

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
          경로 <code className="font-mono">{path}</code> 의 문서가 없어 편집할 수
          없습니다.
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
