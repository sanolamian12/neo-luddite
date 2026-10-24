import assert from "node:assert/strict";
import { test } from "node:test";
import { OUTCOME_GROUP, OUTCOME_LABEL, groupOutcomes, outcomeGroup, outcomesOf } from "./outcome-groups";
import { campaignLink, delta, rate } from "../services/admin-usage";

test("모든 묶음 갈래에 화면 이름이 있고, 모르는 갈래는 기타로 간다", () => {
  for (const k of Object.keys(OUTCOME_GROUP)) assert.ok(OUTCOME_LABEL[k], k);
  assert.equal(outcomeGroup("brand_new_branch"), "other");
  assert.equal(outcomeGroup(null), "other");
  assert.equal(outcomeGroup("calc_ask"), "asked_back");
});

test("갈래 수를 묶으면 합이 그대로이고, 묶음을 풀면 거르기 원값이 된다", () => {
  const byOutcome = { verdict: 2, calc: 1, calc_ask: 3, off_topic: 1, mystery: 4 };
  const groups = groupOutcomes(byOutcome);
  assert.equal(groups.reduce((a, g) => a + g.count, 0), 11);
  assert.equal(groups.find((g) => g.key === "answered")?.count, 3);
  assert.equal(groups.find((g) => g.key === "other")?.count, 4);
  assert.ok(outcomesOf("asked_back").includes("calc_missing"));
  assert.ok(outcomesOf("other").includes("unsupported_occupation"));
});

test("직전 기간 대비·비율·게시 링크", () => {
  assert.deepEqual(delta(12, 8), { diff: 4, pct: 50 });
  assert.deepEqual(delta(3, 0), { diff: 3, pct: null });
  assert.equal(rate(1, 0), null);
  assert.equal(rate(1, 3), 33);
  assert.equal(campaignLink("https://neo-luddite.vercel.app/", "apsa1"), "https://neo-luddite.vercel.app/r/apsa1");
});
