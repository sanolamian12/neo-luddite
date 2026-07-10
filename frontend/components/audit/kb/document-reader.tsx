"use client";

import Link from "next/link";
import { Pencil } from "lucide-react";
import type { KbCitation, KbDocument } from "@/lib/kb-schema";
import { KB_CATEGORY_LABELS } from "@/lib/kb-schema";
import { kbEditHrefForPath } from "@/lib/kb-route";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ExtendSeedButton } from "./extend-seed-button";
import { KbMarkdown } from "./markdown-render";
import { ReferencingFeedback } from "./referencing-feedback";

/**
 * KB 문서 리더 — 프론트매터 헤더 + 마크다운 본문 + 메타 사이드.
 * `[[경로]]` 위키 링크는 본문 전처리 단계에서 내부 링크로 변환된다.
 */
export function DocumentReader({ doc }: { doc: KbDocument }) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-6 px-6 py-8 lg:grid-cols-[1fr_240px]">
        <article className="min-w-0">
          <DocumentHeader doc={doc} />
          <div className="kb-prose mt-6">
            <KbMarkdown body={doc.body} />
          </div>
          <ReferencingFeedback docId={doc.id} />
        </article>
        <DocumentMeta doc={doc} />
      </div>
    </div>
  );
}

function DocumentHeader({ doc }: { doc: KbDocument }) {
  return (
    <header className="flex flex-col gap-2 border-b pb-4">
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Badge variant="outline" className="text-[10px]">
          {KB_CATEGORY_LABELS[doc.category]}
        </Badge>
        <Badge
          variant={doc.source === "seed" ? "secondary" : "default"}
          className="text-[10px]"
        >
          {doc.source === "seed" ? "시드" : "사용자"}
        </Badge>
        {doc.source === "user" && (
          <Badge variant="outline" className="text-[10px]">
            {doc.status === "published" ? "발행" : "초안"}
          </Badge>
        )}
        <span aria-hidden>·</span>
        <span className="break-all font-mono text-[11px]">{doc.path}</span>
      </div>

      <h1 className="text-2xl font-bold leading-tight tracking-tight">
        {doc.frontmatter.title}
      </h1>
      {doc.frontmatter.summary && (
        <p className="text-sm text-muted-foreground">
          {doc.frontmatter.summary}
        </p>
      )}

      {doc.source === "seed" && (
        <div className="mt-2 flex flex-col items-start gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between">
          <span>
            이 문서는 시드입니다 — 읽기 전용. 편집하려면 사본을 만드세요.
          </span>
          <ExtendSeedButton seed={doc} />
        </div>
      )}

      {doc.source === "user" && (
        <div className="mt-2 flex items-center justify-end">
          <Link
            href={kbEditHrefForPath(doc.path)}
            className={buttonVariants({ size: "sm", variant: "outline" })}
          >
            <Pencil className="size-3.5" />
            편집
          </Link>
        </div>
      )}
    </header>
  );
}

function DocumentMeta({ doc }: { doc: KbDocument }) {
  const fm = doc.frontmatter;
  const hasMeta =
    !!fm.tags?.length ||
    !!fm.framework ||
    !!fm.occupation ||
    !!fm.caseId ||
    doc.citations.length > 0;

  return (
    <aside className="flex flex-col gap-4 text-sm">
      {!hasMeta && (
        <p className="text-xs text-muted-foreground">메타 정보 없음.</p>
      )}

      {fm.framework && (
        <MetaSection label="프레임워크">
          <Badge variant="secondary" className="text-[10px]">
            {fm.framework}
          </Badge>
        </MetaSection>
      )}

      {fm.occupation && (
        <MetaSection label="직업군">
          <Badge variant="outline" className="text-[10px]">
            {fm.occupation}
          </Badge>
        </MetaSection>
      )}

      {fm.caseId && (
        <MetaSection label="케이스 ID">
          <code className="break-all rounded bg-muted px-1.5 py-0.5 text-[11px]">
            {fm.caseId}
          </code>
        </MetaSection>
      )}

      {!!fm.tags?.length && (
        <MetaSection label="태그">
          <div className="flex flex-wrap gap-1">
            {fm.tags.map((t) => (
              <Badge key={t} variant="outline" className="text-[10px]">
                #{t}
              </Badge>
            ))}
          </div>
        </MetaSection>
      )}

      {doc.citations.length > 0 && (
        <MetaSection label="인용">
          <ul className="flex flex-col gap-1 text-xs">
            {doc.citations.map((c, i) => (
              <li key={i}>{renderCitation(c)}</li>
            ))}
          </ul>
        </MetaSection>
      )}

      <MetaSection label="작성">
        <p className="text-xs text-muted-foreground">
          {doc.reviewer} · {new Date(doc.updatedAt).toLocaleDateString("ko-KR")}
        </p>
      </MetaSection>
    </aside>
  );
}

function MetaSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </h3>
      {children}
    </section>
  );
}

function renderCitation(c: KbCitation) {
  if (c.kind === "case") {
    return (
      <span>
        <Badge variant="outline" className="mr-1 text-[10px]">
          케이스
        </Badge>
        <span className="font-mono">{c.caseId}</span>
        {c.label && (
          <span className="text-muted-foreground"> — {c.label}</span>
        )}
      </span>
    );
  }
  if (c.kind === "law") {
    return (
      <span>
        <Badge variant="outline" className="mr-1 text-[10px]">
          법령
        </Badge>
        {c.ref}
        {c.label && (
          <span className="text-muted-foreground"> — {c.label}</span>
        )}
      </span>
    );
  }
  return (
    <a
      href={c.url}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2"
    >
      <Badge variant="outline" className="mr-1 text-[10px]">
        외부
      </Badge>
      {c.label}
    </a>
  );
}

