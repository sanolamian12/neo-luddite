"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Element, ElementContent } from "hast";

const plugins = [remarkGfm];

function nodeText(node: Element | ElementContent): string {
  if (node.type === "text") return node.value;
  return "children" in node ? node.children.map(nodeText).join("") : "";
}

function numericCell(node: Element | undefined) {
  // Presentation only: never parse, calculate or rewrite an answer's values.
  const text = node ? nodeText(node).trim() : "";
  return /^(?:[₩$€]\s*)?[+−-]?(?:\d[\d,.]*)(?:\s*(?:%|원|만원|억원|천원|건|명|배|일|개월|년))?$/.test(text);
}

function AnswerTable({ children }: { children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const [overflow, setOverflow] = useState(false);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setOverflow(element.scrollWidth > element.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [children]);

  return <div className="answer-table">
    <div ref={viewport} className="answer-table-scroll" role={overflow ? "region" : undefined}
      aria-label={overflow ? "답변 표" : undefined} aria-describedby={overflow ? hintId : undefined}
      tabIndex={overflow ? 0 : undefined}>
      <table><caption className="sr-only">답변 표</caption>{children}</table>
    </div>
    {overflow && <p id={hintId} className="answer-table-hint">좌우로 움직여 나머지 열을 확인하세요.</p>}
  </div>;
}

const components: Components = {
  table: ({ children }) => <AnswerTable>{children}</AnswerTable>,
  th: ({ children, style }) => <th scope="col" style={style}>{children}</th>,
  td: ({ children, node, style }) => <td style={{ ...style, textAlign: style?.textAlign ?? (numericCell(node) ? "right" : undefined) }} data-numeric={numericCell(node) || undefined}>{children}</td>,
  // Images are not part of a textual consultation answer.
  img: ({ alt }) => <span>{alt}</span>,
};

/** Shared renderer for supplied assistant Markdown; raw HTML is never enabled. */
export function AnswerMarkdown({ text }: { text: string }) {
  return <div className="answer-content"><ReactMarkdown remarkPlugins={plugins} components={components} skipHtml>{text}</ReactMarkdown></div>;
}
