import assert from "node:assert/strict";
import { test } from "node:test";
import { filterExperts, paginateExperts } from "./expert-directory.ts";

const experts = [
  {
    auditorId: "a",
    displayName: "김서연",
    bio: "병의원 세무 상담",
    specialties: ["종합소득세"],
    qualifications: ["세무사"],
    availability: "available",
  },
  {
    auditorId: "b",
    displayName: "이준호",
    bio: "사업자를 위한 TAX 상담",
    specialties: ["부가가치세"],
    qualifications: ["회계사"],
    availability: "busy",
  },
  {
    auditorId: "c",
    displayName: "박지수",
    bio: "양도와 상속",
    specialties: ["종합소득세", "상속세"],
    qualifications: ["세무사"],
    availability: "offline",
  },
];

test("search matches names, bios, qualifications and specialties, ignoring whitespace and case", () => {
  for (const [query, ids] of [
    ["김 서연", ["a"]],
    [" tax ", ["b"]],
    ["회계사", ["b"]],
    ["종합소득세", ["a", "c"]],
  ]) {
    assert.deepEqual(
      filterExperts(experts, { query }).map((e) => e.auditorId),
      ids,
    );
  }
});

test("specialty and availability filters intersect with search and preserve ranking", () => {
  assert.deepEqual(
    filterExperts(experts, { specialty: "종합소득세" }).map((e) => e.auditorId),
    ["a", "c"],
  );
  assert.deepEqual(
    filterExperts(experts, {
      specialty: "종합소득세",
      availability: "available",
    }).map((e) => e.auditorId),
    ["a"],
  );
  assert.deepEqual(
    filterExperts(experts, { query: "김", availability: "busy" }),
    [],
  );
  assert.deepEqual(filterExperts(experts, { query: "  " }), experts);
});

test("pagination exposes every expert once and clamps a stale page after filtering", () => {
  const items = Array.from({ length: 13 }, (_, id) => ({ id }));
  assert.deepEqual(
    paginateExperts(items, 1, 6).items.map((e) => e.id),
    [0, 1, 2, 3, 4, 5],
  );
  assert.deepEqual(
    paginateExperts(items, 2, 6).items.map((e) => e.id),
    [6, 7, 8, 9, 10, 11],
  );
  assert.deepEqual(
    paginateExperts(items, 3, 6).items.map((e) => e.id),
    [12],
  );
  assert.equal(paginateExperts(items, 3, 6).pageCount, 3);
  assert.deepEqual(paginateExperts(items.slice(0, 2), 3, 6), {
    items: [{ id: 0 }, { id: 1 }],
    page: 1,
    pageCount: 1,
  });
  assert.deepEqual(paginateExperts([], 3, 6), {
    items: [],
    page: 1,
    pageCount: 1,
  });
});
