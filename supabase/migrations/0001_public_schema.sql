-- ════════════════════════════════════════════════════════════════════════════
-- Workstream A — public.* schema (Seam B platform state)
-- ════════════════════════════════════════════════════════════════════════════
-- 마스터설계 §4-A · §3-1(네임스페이스: 비즈니스=public.*, RAG=rag.*)
--
-- 설계 규칙 (프론트 시그니처 불변 §3-3 을 위해):
--   • PK 는 앱이 생성하는 문자열 id 를 그대로 보존 → text PRIMARY KEY.
--   • 모든 시각 필드(*_at, deadline, timestamp)는 TS `number`(epoch ms) 를
--     그대로 담기 위해 bigint. (Postgres timestamptz 로 변환하지 않음 —
--     services/*.ts 가 Date.now() 숫자를 주고받으므로 왕복 무손실.)
--   • zod 하위 오브젝트/오브젝트배열(pickups·conditions·progress·scores·
--     decisions·messages·source_ref·ref·allocations·semver·metrics·pr_meta 등)
--     은 jsonb 로 1:1 저장 → 반환 객체 형태가 Zustand 시절과 바이트 동일.
--   • 단순 문자열 배열(conversation_ids·tags·qualifications 등)은 text[].
--
-- 이 마이그레이션은 스키마만. 인증·RLS 는 0002, 시드는 seed.sql.
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── profiles ─────────────────────────────────────────────────────────────────
-- account-store(viewer/auditor/admin) 를 Supabase Auth 로 이관.
-- auth.users(uuid) ↔ 도메인 텍스트 id("viewer"/"auditor"/"admin" 및 추가 평가자).
-- role: 'user'(=구 viewer/사장님) | 'auditor'(=세무사/평가자) | 'admin'(운영자).
create type public.app_role as enum ('user', 'auditor', 'admin');

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  domain_id    text not null unique,          -- 도메인 참조키 (audits.auditor_id 등과 조인)
  role         public.app_role not null,
  label        text not null,                 -- 화면 표기명 ("사장님"/"평가자"/"운영자")
  avatar_color text,
  occupation   text,                          -- viewer 전용
  display_name text,                          -- auditor(reviewerName)/admin(operatorName)
  created_at   bigint not null default (extract(epoch from now()) * 1000)::bigint
);
comment on table public.profiles is 'account-store 이관: Auth 사용자 ↔ 역할/도메인 id';

-- ── auditors (평가자 레지스트리) ───────────────────────────────────────────────
-- poc-schema.auditorEntry. profiles 와 별개의 관리용 레지스트리(§ 다중 평가자).
create table public.auditors (
  id             text primary key,            -- 시드 "auditor" 포함
  display_name   text not null,
  email          text not null,
  phone          text,
  qualifications text[] not null default '{}',
  status         text not null default 'active',   -- active | suspended
  created_at     bigint not null,
  last_active_at bigint,
  note           text
);

-- ── pool_candidates (감사 후보 풀) ─────────────────────────────────────────────
-- poc-schema.poolCandidate. conversationId 가 자연키.
create table public.pool_candidates (
  conversation_id         text primary key,
  occupation              text not null,
  topic                   text,
  turn_count              integer not null,
  first_user_message      text,
  assistant_token_estimate integer,
  added_at                bigint not null,
  status                  text not null default 'new',   -- new | assigned | excluded
  excluded_reason         text
);

-- ── audit_tasks (감사 과제) ────────────────────────────────────────────────────
-- poc-schema.auditTask. pickups/conditions 는 jsonb 로 원형 보존.
create table public.audit_tasks (
  id               text primary key,
  label            text,
  conversation_ids text[] not null,
  capacity         integer not null check (capacity > 0),
  conditions       jsonb,                     -- taskConditionsSchema | null
  deadline         bigint not null,
  created_at       bigint not null,
  created_by       text not null,
  pickups          jsonb not null default '[]',   -- taskPickupSchema[]
  status           text not null default 'open',  -- open | full | in_progress | closed
  note             text
);
create index audit_tasks_status_idx on public.audit_tasks (status);

-- ── audits (감사 메타 래퍼) ────────────────────────────────────────────────────
-- poc-schema.audit. 라인피드백/세션평가는 아래 별도 테이블, progress 는 캐시.
create table public.audits (
  id              text primary key,
  task_id         text not null,
  conversation_id text not null,
  auditor_id      text not null,
  picked_at       bigint not null,
  submitted_at    bigint,
  status          text not null default 'draft',   -- draft|submitted|reviewed|finalized|cancelled
  progress        jsonb not null default '{"feedbackCount":0,"hasSessionEval":false,"totalSegments":0}'
);
create index audits_auditor_idx on public.audits (auditor_id);
create index audits_task_idx on public.audits (task_id);

-- ── line_feedback (라인 피드백) ────────────────────────────────────────────────
-- audit-schema.lineFeedback. conversationId 키(현행), audit_id 는 P2 마이그레이션 대비 nullable.
create table public.line_feedback (
  id              text primary key,
  audit_id        text,                       -- P2: audits.id 로 승격 (지금은 null 허용)
  conversation_id text not null,
  segment_id      text not null,
  reviewer        text not null,
  body            text not null,
  tags            text[] not null default '{}',   -- legal_error | grammar_error | suggestion
  related_kb_ids  text[] not null default '{}',
  created_at      bigint not null
);
create index line_feedback_conv_idx on public.line_feedback (conversation_id);

-- ── session_evaluations (세션 정량 평가) ───────────────────────────────────────
-- audit-schema.sessionEvaluation. audit-store 는 conversationId 를 키로 저장.
create table public.session_evaluations (
  id              text primary key,
  conversation_id text not null unique,       -- store: Record<conversationId, eval>
  reviewer        text not null,
  qualitative     text not null default '',
  scores          jsonb not null,             -- { writing:1-5, legalAccuracy:1-5 }
  created_at      bigint not null
);

-- ── reviews (admin 이 audit 을 검수) ───────────────────────────────────────────
-- poc-schema.review.
create table public.reviews (
  id                     text primary key,
  audit_id               text not null,
  reviewer_id            text not null,
  decisions              jsonb not null default '[]',   -- feedbackDecisionSchema[]
  overall_note           text,
  finalized_at           bigint,
  dispute_window_ends_at bigint,
  status                 text not null default 'draft', -- draft | finalized
  created_at             bigint not null,
  seen_by_auditor_at     bigint
);
create index reviews_audit_idx on public.reviews (audit_id);

-- ── inquiries (평가자 이의제기) ────────────────────────────────────────────────
-- poc-schema.inquiry. messages 는 jsonb 배열(≥1).
create table public.inquiries (
  id                  text primary key,
  audit_id            text not null,
  feedback_id         text,
  raised_by           text not null,
  raised_at           bigint not null,
  messages            jsonb not null,              -- inquiryMessageSchema[] (min 1)
  status              text not null default 'open',-- open | replied | resolved
  amended_feedback_ids text[] not null default '{}'
);
create index inquiries_status_idx on public.inquiries (status);

-- ── ledger_entries (기여 통장) ─────────────────────────────────────────────────
-- poc-schema.ledgerEntry. source_ref 는 discriminated union → jsonb.
create table public.ledger_entries (
  id            text primary key,
  auditor_id    text not null,
  kind          text not null,                 -- contribution_accepted|_rejected|settlement_round|bonus|adjustment
  amount        integer not null,
  source_ref    jsonb not null,                -- ledgerSourceSchema (audit|settlement|manual)
  balance_after integer not null,
  timestamp     bigint not null,
  note          text
);
create index ledger_auditor_idx on public.ledger_entries (auditor_id);

-- ── settlement_rounds (정산 회차) ──────────────────────────────────────────────
-- poc-schema.settlementRound. allocations 는 jsonb 배열.
create table public.settlement_rounds (
  id                 text primary key,
  label              text not null,
  period_from        bigint not null,
  period_to          bigint not null,
  pool               integer not null,
  distribution_model text not null,            -- even | weighted_by_count
  allocations        jsonb not null default '[]',
  status             text not null default 'draft',  -- draft | published
  created_at         bigint not null,
  created_by         text not null,
  published_at       bigint,
  note               text
);

-- ── training_batches / model_versions (모델 파이프라인 mock) ────────────────────
-- poc-schema.trainingBatch / modelVersion.
create table public.training_batches (
  id                   text primary key,
  label                text not null,
  accepted_feedbacks   jsonb not null default '[]',  -- acceptedFeedbackRefSchema[]
  contributor_ids      text[] not null default '{}',
  created_at           bigint not null,
  created_by           text not null,
  status               text not null default 'queued',
  pr_meta              jsonb,
  target_model_version text,
  notes                text,
  failure_reason       text
);

create table public.model_versions (
  id                    text primary key,
  semver                jsonb not null,              -- { major, minor, patch }
  status                text not null default 'candidate',
  created_at            bigint not null,
  promoted_at           bigint,
  retired_at            bigint,
  merged_from_batch_ids text[] not null default '{}',
  source_pr             jsonb,
  metrics               jsonb,
  notes                 text
);

-- ── mail (공지/이의답변/정산안내) ──────────────────────────────────────────────
-- poc-schema.mail. ref 는 discriminated union → jsonb.
create table public.mail (
  id           text primary key,
  recipient_id text not null,
  sender_id    text not null,
  kind         text not null,                  -- notice | inquiry_reply | settlement
  subject      text not null,
  body         text not null default '',
  ref          jsonb,                          -- mailRefSchema | null
  sent_at      bigint not null,
  read_at      bigint
);
create index mail_recipient_idx on public.mail (recipient_id);

-- ── kb_documents (지식베이스 — 사용자 작성분) ─────────────────────────────────
-- kb-schema.kbDocument. 시드 문서는 코드 생성이라 저장 대상 아님(사용자 작성분만).
create table public.kb_documents (
  id          text primary key,
  path        text not null,
  category    text not null,                   -- skill-master|interpretation-framework|occupation|case-precedent|glossary|pitfall
  frontmatter jsonb not null,                  -- { title, summary?, tags?, occupation?, caseId?, framework? }
  body        text not null default '',
  citations   jsonb not null default '[]',     -- kbCitationSchema[]
  source      text not null default 'user',    -- seed | user
  status      text not null default 'draft',   -- draft | published
  reviewer    text not null,
  created_at  bigint not null,
  updated_at  bigint not null
);

-- 제외(§4-A 범위 밖): replay-store(런타임 UI 전용), uploaded-conversation-store
--   (Conversation 코퍼스 = Seam A/불변 데이터, 필요 시 후속 마이그레이션에서 추가).
