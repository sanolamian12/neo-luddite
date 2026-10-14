import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SegmentRenderer } from "../components/chat/segment-renderer";
import { ANSWER_DISPLAY, isStatuteCitation } from "./answer-display";
import { messageSchema } from "./conversation-schema";

const message = {
  id: "answer-2", role: "assistant" as const, order: 1,
  segments: [
    { id: "s0", type: "summary" as const, text: "제조업은 원칙적으로 간이과세를 받을 수 없습니다.", citations: ["부가가치세법 시행령 제109조"] },
    { id: "s1", type: "rule_statement" as const, text: "조문 설명입니다.", citations: ["부가가치세법 제61조", "서면-2021-법규부가-6187"] },
  ],
};

test("summary segment type passes the response schema", () => {
  assert.equal(messageSchema.safeParse(message).success, true);
});

test("summary segment is emphasized and keeps its anchor", () => {
  const html = renderToStaticMarkup(createElement(SegmentRenderer, { message }));
  assert.match(html, /data-segment-type="summary"/);
  if (ANSWER_DISPLAY.emphasizeSummary) assert.match(html, /answer-summary/);
  assert.match(html, /간이과세를 받을 수 없습니다/);
});

test("law fold setting decides where statute badges appear", () => {
  const html = renderToStaticMarkup(createElement(SegmentRenderer, { message }));
  assert.match(html, /서면-2021-법규부가-6187/);   // 문서번호 배지는 어느 쪽이든 문장 옆
  assert.equal(/근거 법령 \d+개/.test(html), ANSWER_DISPLAY.lawFold);
  assert.match(html, /부가가치세법 제61조/);
});

test("statute citations are told apart from case numbers", () => {
  assert.equal(isStatuteCitation("소득세법 제55조"), true);
  assert.equal(isStatuteCitation("부가가치세법 시행령 제109조 제2항"), true);
  assert.equal(isStatuteCitation("조심 2024서5192"), false);
  assert.equal(isStatuteCitation("서면-2021-법규부가-6187"), false);
});
