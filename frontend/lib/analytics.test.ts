import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeFirstTouch, nextSession, SESSION_IDLE_MS, touchFrom } from "./analytics";

const SITE = "https://neo-luddite.vercel.app";

test("utm·ref·외부 referrer 를 읽고, 같은 사이트 referrer·잘못된 코드는 버린다", () => {
  assert.deepEqual(
    touchFrom(`${SITE}/?utm_source=APSA&utm_medium=community&utm_campaign=post1&ref=apsa1`, "https://cafe.naver.com/jihosoccer123"),
    { source: "apsa", medium: "community", campaign: "post1", ref: "apsa1", referrer_host: "cafe.naver.com" },
  );
  assert.deepEqual(touchFrom(`${SITE}/chat?ref=Bad%20Code`, `${SITE}/`), {});
  assert.deepEqual(touchFrom(`${SITE}/`, "not a url"), {});
});

test("첫 유입은 경로가 있는 첫 방문으로 고정된다 — 직접 방문 자리만 나중 방문이 채운다", () => {
  const direct = mergeFirstTouch(null, {}, "/", 1);
  assert.deepEqual(direct, { landing: "/", at: 1 });
  const fromCafe = mergeFirstTouch(direct, { ref: "apsa1" }, "/", 2);
  assert.deepEqual(fromCafe, { ref: "apsa1", landing: "/", at: 2 });
  assert.equal(mergeFirstTouch(fromCafe, { source: "kyungrinara" }, "/", 3), fromCafe);
  assert.equal(mergeFirstTouch(fromCafe, {}, "/chat", 4), fromCafe);
});

test("30분 무활동이면 새 세션", () => {
  let n = 0;
  const id = () => `s${++n}`;
  const first = nextSession(null, 1000, id);
  assert.deepEqual(first, { id: "s1", last: 1000, isNew: true });
  assert.deepEqual(nextSession(first, 1000 + SESSION_IDLE_MS - 1, id), { id: "s1", last: 1000 + SESSION_IDLE_MS - 1, isNew: false });
  assert.equal(nextSession(first, 1000 + SESSION_IDLE_MS, id).isNew, true);
});
