import assert from "node:assert/strict";
import { test } from "node:test";
import { createPractice, retrieveCases } from "./agent-practice";
import { createContribution, emptyBoard, emptyPayload, reviewContribution, submitContribution } from "./knowledge-contributions";
import { withSharedKnowledge } from "./shared-knowledge";

test("only published versions reach another expert's retrieval and retraction removes them", () => {
  const author = { id: "expert-one", name: "전문가 A", role: "expert" as const };
  const reviewer = { id: "admin", name: "검토자", role: "reviewer" as const };
  const checks = { evidence: true, privacy: true, duplicates: true, applicability: true };
  let board = createContribution(emptyBoard(), { agentId: "agent-one", sourceId: "case-one", payload: { ...emptyPayload(), title: "공유 자료 준비", facts: "공유 예시 사실", judgment: "공유 예시 판단", conclusion: "출처가 연결된 공유 답변", keywords: "공유자료", scope: "자료 확인", sources: "가상 검토 근거" } }, author);
  const id = board.entries[0].id;
  const other = createPractice();
  assert.equal(retrieveCases(withSharedKnowledge(other, board), "공유자료").length, 0);
  board = submitContribution(board, id, author, { privacy: true, permission: true }, 1);
  board = reviewContribution(board, id, reviewer, "publish", "근거 확인", checks, 2);
  const found = retrieveCases(withSharedKnowledge(other, board), "공유자료");
  assert.equal(found[0]?.conclusion, "출처가 연결된 공유 답변");
  assert.equal(found[0]?.community?.author, "전문가 A");
  assert.equal(found[0]?.community?.contributionId, id);
  assert.equal(other.cases.length, 2);
  board = reviewContribution(board, id, reviewer, "retract", "철회", checks, 3);
  assert.equal(retrieveCases(withSharedKnowledge(other, board), "공유자료").length, 0);
});
