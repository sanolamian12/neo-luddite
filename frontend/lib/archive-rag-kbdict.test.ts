import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// 0060 rag 옛 KB·kbdict 보관(절단 S6b) — 실제 PostgreSQL(PGlite)에서 이동·함수 삭제·cascade·탈퇴 파기·재실행을 검증한다
// (운영 DB 에 접속하지 않는다). 0059 를 먼저 적용해 운영과 같은 순서로 올린다.
const db = new PGlite();
const migration = (name: string) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");

before(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create table public.conversations (id text primary key, owner_id text not null, payload jsonb);
    create schema rag;
    create table rag.passages (id text primary key, conversation_id text, content text);
    create index passages_conversation_idx on rag.passages (conversation_id);
    create table rag.passage_edges (
      source_id text references rag.passages (id) on delete cascade,
      target_id text references rag.passages (id) on delete cascade,
      score real, primary key (source_id, target_id));
    create table rag.passage_edits (id text primary key, passage_id text references rag.passages (id) on delete cascade);
    create table rag.chat_turns (id text primary key, conversation_id text);
    create function rag.match_passages(query_embedding real[], match_count integer, filter_occupation text, filter_tax_category text)
      returns setof rag.passages language sql as $$ select * from rag.passages limit match_count $$;
    create schema kbdict;
    create table kbdict.documents (id text primary key, title text);
    create table kbdict.chunks (id text primary key, document_id text references kbdict.documents (id) on delete cascade, content text);
    create function kbdict.match_chunks(query_embedding real[], match_count integer, filter_occupation text)
      returns setof kbdict.chunks language sql as $$ select * from kbdict.chunks limit match_count $$;
    grant usage on schema rag to anon, authenticated;
    grant select on all tables in schema rag to anon, authenticated;
    insert into rag.passages values ('p1', 'c1', '번들1'), ('p2', 'c2', '번들2'), ('p3', null, '대화 없음');
    insert into rag.passage_edges values ('p1', 'p2', 0.9), ('p2', 'p3', 0.8);
    insert into rag.passage_edits values ('e1', 'p1');
    insert into rag.chat_turns values ('t1', 'c1');
    insert into kbdict.documents values ('d1', '사전');
    insert into kbdict.chunks values ('k1', 'd1', '골프 회원권'), ('k2', 'd1', '접대비');
  `);
  await db.exec(migration("0059_archive_old_review_tables.sql"));
  await db.exec(migration("0060_archive_rag_kbdict.sql"));
});
after(() => db.close());

const reg = async (name: string) => (await db.query<{ r: string | null }>("select to_regclass($1)::text r", [name])).rows[0].r;
const n = async (sql: string) => Number((await db.query<{ n: number }>(`select count(*)::int n from (${sql}) x`)).rows[0].n);

test("rag old KB tables move to archive with rows and index; chat_turns stays in rag", async () => {
  for (const t of ["passages", "passage_edges", "passage_edits"]) {
    assert.equal(await reg(`rag.${t}`), null, `rag.${t} should be gone`);
    assert.equal(await reg(`archive.${t}`), `archive.${t}`);
  }
  assert.equal(await n("select * from archive.passages"), 3);
  assert.equal(await n("select * from archive.passage_edges"), 2);
  assert.equal(await reg("archive.passages_conversation_idx"), "archive.passages_conversation_idx");
  assert.equal(await reg("rag.chat_turns"), "rag.chat_turns");
  assert.equal(await n("select * from rag.chat_turns"), 1);
});

test("kbdict tables move to archive under prefixed names with their FK; kbdict schema is dropped", async () => {
  assert.equal(await reg("archive.kbdict_documents"), "archive.kbdict_documents");
  assert.equal(await reg("archive.kbdict_chunks"), "archive.kbdict_chunks");
  assert.equal(await n("select * from archive.kbdict_chunks"), 2);
  assert.equal(await n("select 1 from pg_namespace where nspname = 'kbdict'"), 0);
  assert.equal(await n(`select 1 from pg_constraint where contype = 'f'
    and conrelid = 'archive.kbdict_chunks'::regclass and confrelid = 'archive.kbdict_documents'::regclass`), 1);
});

test("search functions are dropped", async () => {
  assert.equal(await n(`select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where p.proname in ('match_passages', 'match_chunks')`), 0);
});

test("API roles cannot read archived rag tables", async () => {
  await db.exec("set role anon");
  await assert.rejects(db.query("select * from archive.passages"), /permission denied/);
  await db.exec("reset role");
});

test("account deletion purge still removes archived passages and cascades edges/edits", async () => {
  const res = await db.query<{ r: { legacy_review_rows: number } }>("select public._purge_legacy_review_rows(array['c1']) r");
  assert.equal(res.rows[0].r.legacy_review_rows, 1);                     // 대화 c1 의 passage 1건
  assert.equal(await n("select * from archive.passages where conversation_id = 'c1'"), 0);
  assert.equal(await n("select * from archive.passage_edits"), 0);        // p1 의 수정 제안 cascade
  assert.equal(await n("select * from archive.passage_edges where source_id = 'p1'"), 0);
  assert.equal(await n("select * from archive.passages"), 2);
});

test("re-running 0060 is harmless", async () => {
  await db.exec(migration("0060_archive_rag_kbdict.sql"));
  assert.equal(await n("select * from archive.passages"), 2);
  assert.equal(await n("select * from archive.kbdict_chunks"), 2);
});
