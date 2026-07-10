"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { kbHrefForPath } from "@/lib/kb-route";
import { KB_SEEDS } from "@/lib/kb-seeds";
import { folderLabel, pathLeaf } from "@/lib/kb-schema";

/**
 * KB 마크다운 렌더링 공통화 — 리더·에디터 프리뷰가 동일 스타일을 공유.
 * 본문 전처리 단계에서 `[[ascii/경로]]` 위키 링크를 `[한국어 라벨](kb-href)` 로 변환한다.
 *
 * 라벨 결정 우선순위:
 *  1) 해당 path 의 시드 문서가 있으면 `frontmatter.title`
 *  2) 폴더 path 면 `KB_FOLDER_LABELS` 의 한국어 폴더명 (마지막 세그먼트 기준)
 *  3) fallback: path 마지막 세그먼트
 */
function resolveWikiLabel(path: string): string {
  const seed = KB_SEEDS.find((d) => d.path === path);
  if (seed) return seed.frontmatter.title;
  const leaf = pathLeaf(path);
  const labeled = folderLabel(leaf);
  return labeled || leaf;
}

export function preprocessWikiLinks(body: string): string {
  return body.replace(/\[\[([^\]]+)\]\]/g, (_m, raw: string) => {
    const path = raw.trim();
    const href = kbHrefForPath(path);
    const label = resolveWikiLabel(path);
    return `[${label}](${href})`;
  });
}

type MarkdownComponents = NonNullable<
  React.ComponentProps<typeof ReactMarkdown>["components"]
>;

export const KB_MD_COMPONENTS: MarkdownComponents = {
  a: ({ href, children, ...rest }) => {
    if (typeof href === "string" && href.startsWith("/")) {
      return (
        <Link
          href={href}
          className="font-medium text-brand-blue underline underline-offset-2 hover:text-brand-blue/80"
        >
          {children}
        </Link>
      );
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2"
        {...rest}
      >
        {children}
      </a>
    );
  },
  h1: ({ children }) => (
    <h1 className="mt-2 text-xl font-bold tracking-tight">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-6 mb-2 text-lg font-semibold">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-4 mb-1 text-base font-semibold">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="my-2 leading-relaxed text-foreground">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-brand-blue bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground">
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] break-words [overflow-wrap:anywhere]">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-3 max-w-full overflow-x-auto">{children}</pre>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
};

export function KbMarkdown({ body }: { body: string }) {
  return (
    <ReactMarkdown components={KB_MD_COMPONENTS}>
      {preprocessWikiLinks(body)}
    </ReactMarkdown>
  );
}
