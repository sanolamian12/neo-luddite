"use client";

import { useRouter } from "next/navigation";
import { GitFork } from "lucide-react";
import type { KbDocument } from "@/lib/kb-schema";
import { useKbStore } from "@/lib/kb-store";
import { useAccountStore } from "@/lib/account-store";
import { kbEditHrefForPath } from "@/lib/kb-route";
import { Button } from "@/components/ui/button";

/**
 * 시드 문서 헤더의 "확장" 버튼.
 * 클릭 → user 사본 생성 → 에디터로 라우팅.
 */
export function ExtendSeedButton({ seed }: { seed: KbDocument }) {
  const router = useRouter();
  const extendFromSeed = useKbStore((s) => s.extendFromSeed);
  const reviewer = useAccountStore((s) => s.auditor.reviewerName);

  const onClick = () => {
    const doc = extendFromSeed(seed, reviewer);
    router.push(kbEditHrefForPath(doc.path));
  };

  return (
    <Button size="sm" variant="outline" onClick={onClick}>
      <GitFork className="size-3.5" />
      이 문서를 확장
    </Button>
  );
}
