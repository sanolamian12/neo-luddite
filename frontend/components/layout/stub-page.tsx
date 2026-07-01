import { Construction } from "lucide-react";

/**
 * 스캐폴드 단계의 라우트 본문 — 추후 단계에서 실 컨텐츠로 교체된다.
 */
export function StubPage({
  title,
  description,
  phase,
}: {
  title: string;
  description?: string;
  phase?: string;
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      <main className="mx-auto w-full max-w-3xl px-6 py-10">
        <div className="flex items-start gap-3">
          <Construction className="mt-1 size-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            {description && (
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            )}
            {phase && (
              <p className="mt-3 text-xs text-muted-foreground">
                <span className="rounded-full border px-2 py-0.5">단계: {phase}</span>
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
