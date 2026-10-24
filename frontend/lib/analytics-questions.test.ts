import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// 0063 사용 현황 M2 — chat_turns 보강·channel 소급 · 질문 원문 가림(트리거)·권한·90일 파기를 PGlite 에서 확인한다.
// 가림 예문은 backend/api/test_turn_record.py 와 같다(백엔드 가림 = DB 가림).
const db = new PGlite();
const migration = (name: string) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");

before(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema analytics;
    create schema rag;
    create table rag.chat_turns (message_id text primary key, conversation_id text, created_at bigint, outcome text);
    insert into rag.chat_turns values ('m1', 'local-1', 1, 'verdict'), ('m2', 'room_1', 1, 'advisory'),
      ('m3', 'studio_a_1', 1, 'advisory'), ('m4', 'eval-r0-1', 1, 'calc'), ('m5', 'my_conv', 1, 'calc');
  `);
  await db.exec(migration("0063_chat_turns_analytics_questions.sql"));
});

after(async () => { await db.close(); });

test("chat_turns 에 새 칸이 생기고 channel 은 접두로 소급된다", async () => {
  const rows = (await db.query("select message_id, channel, tax_topic from rag.chat_turns order by message_id")).rows;
  assert.deepEqual(rows, [
    { message_id: "m1", channel: "chat", tax_topic: null },
    { message_id: "m2", channel: "room", tax_topic: null },
    { message_id: "m3", channel: "studio", tax_topic: null },
    { message_id: "m4", channel: "eval", tax_topic: null },
    { message_id: "m5", channel: "chat", tax_topic: null },
  ]);
  await db.exec("alter table rag.chat_turns add column if not exists latency_ms integer");   // 재실행 안전
});

test("질문 원문은 넣을 때 식별정보가 가려지고 세무 내용은 남는다", async () => {
  const cases: [string, string][] = [
    ["연락처 010-1234-5678 로 주세요", "연락처 [가림] 로 주세요"],
    ["01012345678", "[가림]"],
    ["사무실 02-123-4567", "사무실 [가림]"],
    ["메일 boss@shop.co.kr 입니다", "메일 [가림] 입니다"],
    ["주민번호 900101-1234567", "주민번호 [가림]"],
    ["사업자 123-45-67890 입니다", "사업자 [가림] 입니다"],
    ["계좌 110-123-456789", "계좌 [가림]"],
    ["연봉 5,000만원이면 소득세 얼마예요?", "연봉 5,000만원이면 소득세 얼마예요?"],
    ["2024-10-23 에 산 차량 감가상각", "2024-10-23 에 산 차량 감가상각"],
    ["부가세 10% 1,200,000원", "부가세 10% 1,200,000원"],
  ];
  for (const [raw, want] of cases) {
    const row = (await db.query("insert into analytics.questions (conversation_id, message_id, text_masked) values ('local-1', 'm1', $1) returning text_masked", [raw])).rows[0] as { text_masked: string };
    assert.equal(row.text_masked, want, raw);
  }
});

test("anon·authenticated 는 질문 표를 읽거나 쓰지 못하고, 90일 지난 것만 파기된다", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query("select count(*) from analytics.questions"), /permission denied/);
    await db.exec("reset role");
  }
  await db.exec("delete from analytics.questions");
  await db.exec("insert into analytics.questions (conversation_id, text_masked, created_at) values ('a', '옛 질문', now() - interval '91 days'), ('b', '새 질문', now())");
  const purged = (await db.query("select public.purge_old_analytics_questions() as k")).rows[0] as { k: number };
  assert.equal(purged.k, 1);
  assert.deepEqual((await db.query("select text_masked from analytics.questions")).rows, [{ text_masked: "새 질문" }]);
});
