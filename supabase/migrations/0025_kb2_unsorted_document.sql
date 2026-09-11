-- ════════════════════════════════════════════════════════════════════════════
-- kb2 '기타' 세목 — 미분류를 버리지 않고 트리에만 남긴다 (2026-09-11)
-- ════════════════════════════════════════════════════════════════════════════
-- 지금까지 분류가 '미분류'로 끝난 상담(실측 413건 중 182건, 44%)은 **어느 문서에도
-- 안 실리고 사라졌다**. 세무사는 그런 상담이 있었다는 사실조차 화면에서 볼 수 없다.
--
-- 사용자 결정(2026-09-11): **"트리에는 보이되 match_sentences 에서는 빠진다."**
-- 세무사는 '기타'를 열어보고 문장을 진짜 세목으로 직접 옮길 수 있지만, 옮기기 전까지는
-- 검색·답변 경로에 들어가지 않는다 — 분류가 안 될 만큼 잡다한 문장이 KB2 검색을
-- 오염시키면 안 되기 때문이다.
--
-- ── 왜 새 status 인가 ('retired' 재사용이 아니라) ───────────────────────────
-- documents.status 에는 이미 두 값이 있다: 'retired'(사람이 사유를 적고 끊음, 0024)와
-- 'archived'(재구조화 세대교체, 0020). '기타'는 **재구조화가 매 회차 새로 만드는** 것이라
-- 둘 중 어느 쪽도 아니고, 'retired' 로 두면 실제로 위험하다:
--
--   kb2_store.set_document_status 가 `where status in ('active','retired')` 라서,
--   세무사가 트리에서 [세목 재연결] 을 한 번 누르면 미분류 182건이 통째로 검색에
--   들어온다 — 이번 결정이 막으려던 바로 그 일이다. 새 값 'unsorted' 는 같은 WHERE 절에
--   안 걸려서 **추가 가드 없이** 그 전환이 거부된다.
--
-- 또 'retired' 는 화면에서 document_events 의 사유를 배지로 띄우는데(누가 왜 끊었나),
-- '기타'는 행위자도 사유도 없어 그 목록을 기계가 만든 문서로 오염시킨다.
--
-- kb2.match_sentences 는 이미 d.status = 'active' 만 보므로 **SQL 함수 변경은 불필요**
-- 하다(0022·0024 와 같은 이유). 대신 kb2_store.archive_all_active_documents 가
-- 'unsorted' 도 함께 내리도록 넓혔다 — 안 그러면 세대교체 때 '기타'만 안 내려가고
-- 회차마다 죽은 '기타'가 하나씩 쌓인다(0023 이 카테고리에서 고쳤던 그 버그).
-- ════════════════════════════════════════════════════════════════════════════

alter table kb2.documents
  drop constraint documents_status_check,
  add constraint documents_status_check
    check (status in ('active', 'archived', 'retired', 'unsorted'));

-- ── 원문 보관은 '합성'이 아니다 ─────────────────────────────────────────────
-- '기타'에는 합성을 돌리지 않는다(결정 2026-09-11). 합성 프롬프트는 "같은 주제의 상담
-- 묶음"을 전제로 조항 문장을 뽑고, 인용률을 96% 로 올린 처방(커버 규칙 + 청크당 ~9건)이
-- 그 응집성 위에 서 있다. '기타'는 정의상 주제가 없어서 서로 무관한 상담을 한 프롬프트에
-- 넣으면 공허한 일반화나 없는 연결이 나온다 — 그리고 그 문장은 세무사가 진짜 세목으로
-- 옮기는 순간 진짜 조항과 구별되지 않는다. 그래서 원문을 1건 = 문장 1개로 그대로 둔다.
--
-- 그러면 v1 이력의 editor_type 이 'system_synthesis' 면 거짓말이 된다. 원문 보관을
-- 따로 표기해, 옮겨진 문장의 이력이 정직하게 읽히도록 한다:
--   v1 system_unsorted(원문 보관) → v2 moved → v3 auditor_edit
alter table kb2.sentence_versions
  drop constraint sentence_versions_editor_type_check,
  add constraint sentence_versions_editor_type_check
    check (editor_type in (
      'system_synthesis', 'system_unsorted', 'auditor_edit', 'admin_revert',
      'moved', 'retired', 'reconnected'
    ));
