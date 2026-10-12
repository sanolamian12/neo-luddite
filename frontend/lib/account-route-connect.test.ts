import test from "node:test";
import assert from "node:assert/strict";
import { loginHref, publicReturnPath } from "./account-route";

// R3 즉시 연결(10/12) — 로그인 뒤 같은 대화로 돌아와 고른 세무사와 바로 연결한다.
test("keeps a safe connect id next to the conversation id", () => {
  assert.equal(publicReturnPath("/chat/clinic?c=local-abc&connect=auditor2"), "/chat/clinic?c=local-abc&connect=auditor2");
});

test("drops connect without a conversation or with unsafe characters", () => {
  assert.equal(publicReturnPath("/chat/clinic?connect=auditor2"), "/chat/clinic");
  assert.equal(publicReturnPath("/chat/clinic?c=local-abc&connect=a%20b%3Cscript"), "/chat/clinic?c=local-abc");
});

test("still strips unrelated parameters", () => {
  assert.equal(publicReturnPath("/chat/clinic?c=local-abc&utm=x"), "/chat/clinic?c=local-abc");
});

test("login href round-trips the connect id", () => {
  const href = loginHref("/chat/clinic?c=local-abc&connect=auditor");
  const next = new URL(href, "https://local.invalid").searchParams.get("next");
  assert.equal(publicReturnPath(next), "/chat/clinic?c=local-abc&connect=auditor");
});
