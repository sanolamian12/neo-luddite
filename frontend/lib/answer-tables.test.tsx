import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SegmentRenderer } from "../components/chat/segment-renderer";
import type { Message } from "./conversation-schema";

function render(text: string, role: Message["role"] = "assistant") {
  return renderToStaticMarkup(createElement(SegmentRenderer, { message: {
    id: "answer-1", role, order: 1,
    segments: [{ id: "source-segment", type: "application", text, citations: ["원문 출처"] }],
  } }));
}

// These fail if assistant tables are flattened, values change, or segment anchors disappear.
test("assistant tables preserve values, inline emphasis and source anchors", () => {
  const html = render("요약입니다.\n\n| 항목 | 금액 |\n| --- | ---: |\n| 매출 | **1,234,567원** |\n| 조정 | -12,000원 |\n\n추가 설명입니다.");
  assert.match(html, /<table/);
  assert.match(html, /scope="col"[^>]*>항목/);
  assert.match(html, /<strong>1,234,567원<\/strong>/);
  assert.match(html, /-12,000원/);
  assert.match(html, /data-segment-id="source-segment"/);
  assert.match(html, /원문 출처/);
  assert.match(html, /추가 설명입니다/);
  assert.doesNotMatch(html, /<p[^>]*>\s*<div/);
});

test("escaped pipes and code examples do not corrupt table cells", () => {
  const html = render("| 구분 | 비고 |\n| --- | --- |\n| A \\| B | `10%` |\n\n```text\n| 이것은 | 코드 |\n| --- | --- |\n```");
  assert.equal((html.match(/<table/g) ?? []).length, 1);
  assert.match(html, /A \| B/);
  assert.match(html, /<code>10%<\/code>/);
  assert.match(html, /이것은/);
});

test("user input stays literal even when it contains markdown tables", () => {
  const html = render("| 항목 | 금액 |\n| --- | --- |\n| 매출 | 10원 |", "user");
  assert.doesNotMatch(html, /<table/);
  assert.match(html, /\| 항목 \| 금액 \|/);
});

test("assistant content never executes raw HTML or unsafe links", () => {
  const html = render("| 항목 | 내용 |\n| --- | --- |\n| 입력 | <img src=x onerror=alert(1)> |\n\n[링크](javascript:alert%281%29)");
  assert.match(html, /<table/);
  assert.doesNotMatch(html, /<img|onerror=|href="javascript:/);
});
