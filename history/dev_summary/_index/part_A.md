# P0 소스 인덱스 — part A (W05 08-30~09-05 · W06 09-06~09-12)

대상 6개 문서. 원문 수치·추론은 그대로 옮겼고, 원문에 없는 내용은 보태지 않았다.

---

### 260831_미확정검수데이터_논문오인정정_submitted감사52건삭제.md
- 날짜 / 주차: 08-31 / W05
- 주제: 검수 데이터 정리(운영 DB 정리)
- 포지션: ● BE · PO / ○ RS · FE
- 한 문단 요약: admin "완료" 메뉴에 07-16~21 auditor·auditor2·auditor3이 제출해 놓고 확정하지 않은 항목이 많이 보였다. PO는 이를 ICTC 논문 데이터로 기억했는데, 선행 조사 문서(`docs/academic paper/db_backup_260806/README.md`)를 확인해 보니 논문 데이터가 아니라 제품 개발 작업(100건 일괄감사·RAG 재검증)이 남긴 검수 대기열이었다. 미확정이 쌓인 근본 원인은 당시 `session_evaluations`에 admin 쓰기 RLS가 없던 버그였고, 0015로 이미 고쳐져 있었다. 1차로 `session_evaluations` finalized 39건을 지웠지만 "완료" 화면과는 상관없는 테이블이었다. 타깃을 바로잡아 2차로 `status='submitted'` audits 52건과 연쇄 데이터를 지웠고, 두 차례 모두 RAG 손실은 없었다. 남은 일은 auditor3 `reviewed` 2건 처리를 결정하는 것이다.
- 핵심 수치:
  - 논문이 DB에 남긴 흔적은 `rag.passages` 168건(07-27 상태변경) 하나뿐이며 이미 복구됨
  - 07/11~12 100개 대화 검수 → 07/14 최종승인 → `rag.passages` 362건 적재
  - 07-18 시점 기록: session_evaluations 193건, finalized 0건
  - session_evaluations(07-16~22): auditor 36(27fin+9pend) / auditor2 10(전부 fin) / auditor3 8(2fin+6pend) = 54(39 finalized / 15 pending)
  - 1차 삭제: session_evaluations 39건, session_eval active 120건 유지
  - 2차 대상: auditor submitted+draft 12 / submitted+리뷰없음 24 / auditor2 submitted+리뷰없음 10 / auditor3 submitted+draft 4 / submitted+리뷰없음 2 / auditor3 reviewed(saved) 2건은 제외
  - `line_feedback.audit_id` 전체 567건이 NULL
  - 2차 삭제: audits 52 · reviews 16(draft) · line_feedback 186. feedback active 287, session_eval active 120으로 삭제 전후 동일
- 포지션별 몫:
  - BE: `purge_finalized_session_evals.py`, `purge_submitted_audits.py`, `verify_after_purge.py`(스크래치패드, 비커밋)를 작성했다. 프로덕션 Supabase에 직접 DELETE를 실행했고, 삭제 순서는 `line_feedback`→`reviews`→`audits`, 단계마다 rowcount를 검증했다. `supabase/apply_migration.py`의 `db_url()`을 재사용하고 `reset_session_eval_review.py`를 템플릿으로 삼았다.
  - BE: 삭제 전 안전 확인을 했다. (auditor_id, conversation_id) 쌍이 겹치는지(0건), RAG 반영 여부(source_kind='feedback' active 0건), reviews가 non-draft면 자동 중단하는 가드, JSON 백업 2개를 확인·적용했다.
  - PO: 삭제 범위를 확정했다("검수실(문장단위) '제출됨'만, admin·auditor 양쪽에서 안 보이게").
  - RS: 논문 데이터라는 가설을 기각했다. 근거는 `db_backup_260806/README.md`와 `history/260718` 재독이다.
  - FE: 원인을 진단했다. "완료" 화면(`/audit/results`, `results-table.tsx`)은 `audits`+`reviews`+`line_feedback` 기반이고, `session_evaluations`는 "배선실(정성평가)" 탭 몫이다.
- 결정:
  - [PO 확정] `status='submitted'` audits만 삭제하고 `reviewed` 2건은 제외한다. reviewed는 한 단계 더 진행된 상태이기 때문이다.
  - [구현 판단] finalized session_evaluations 39건을 삭제한다. `rag.passages`에 `source_kind='session_eval'` 독립 사본(텍스트 복사)이 `dedupe_key='session_eval:<id>'`로 39건 전부 active로 매칭되므로 원본을 지워도 지식은 소실되지 않는다.
  - [구현 판단] 안전 절차를 표준으로 삼는다: RAG 매칭 재확인 → 백업 → rowcount 검증 → 커밋.
- 교훈(지뢰):
  - 기억(논문 데이터)과 실제가 달랐다. 정황(같은 주의 A/B 리포트, 07-29 논문 커밋)이 그럴듯해서 가설이 의심받지 않았다. 선행 조사 README와 history를 다시 읽어 바로잡았다. 이제 규칙은 "기억보다 히스토리 문서·DB 실측이 우선"이다.
  - 엉뚱한 테이블을 지웠다. 삭제 자체는 안전했고(RAG 손실 없음) 에러도 없어서 문제가 드러나지 않았다. 사용자가 재로그인했는데 화면이 그대로여서 발견했다. 이제 규칙은 "삭제 전에 화면 → 컴포넌트 → 실제 소스 테이블을 먼저 추적"이다.
  - (과거 원인) admin 결정이 RLS에 막혀 "0행 갱신"으로 조용히 실패했다. 0015에서 수정됐다.
- 검증: 삭제 전후 `rag.passages` 수치를 대조했다(불변). 검증 쿼리로 07-16~22 구간에 auditor3 reviewed 2건만 남았음을 확인했다. 확인 못 한 것: 백업 JSON은 스크래치패드에만 있고 저장소에 커밋되지 않았다.
- 남은 일: auditor3 `reviewed` 2건을 삭제할지 결정해야 한다.
- 주의: 비밀값 없음. auditor/auditor2/auditor3 계정의 검수·세션평가 데이터를 다룬다. **감사 데이터 = Claude 감사모드 산출물(사람 아님).** 원문은 "세무사들이 실작업으로 남긴 검수 대기열"이라고 쓰고 있으므로 재서술할 때 "세무사 실작업" 서사는 피할 것. 프로덕션 직접 DELETE를 실행한 건이다.

---

### 260909_지식베이스2_설계_스키마_합성파이프라인_검색전환.md
- 날짜 / 주차: 09-09 / W06
- 주제: KB2 설계·구축
- 포지션: ● KE · BE / ○ AIE · FE · PO
- 한 문단 요약: 기존 RAG는 [질문/AI답변/세무사코멘트]를 문서 통째로 임베딩해서 긴 문서일수록 정보가 희석된다. 이를 풀려고 Solar Pro가 문장(조항) 단위로 응축한 별도 정책 사전 KB2를 설계했다(설계 아티팩트 발행). 로드맵 1~4단계를 구현했다: 스키마 0019, admin 합성 트리거, `?ragSource=rag|kb2|hybrid` 검색 전환 A/B, auditor 문장 직접 수정. 기존 RAG 경로는 한 줄도 건드리지 않았고, 기본값 `rag`는 기존과 100% 같다. 크레딧 2종 분리·배선실 폐루프(5~6단계)와 17개 세목 풀 합성은 남았다.
- 핵심 수치:
  - 부가가치세 세목(원천 28건) 합성 → 14문장
  - kb2 관련 매치 코사인 0.4985 < `RAG_MIN_SCORE=0.50` → `KB2_MIN_SCORE` 기본 0.35를 신설
  - 문장 수정 시 version 1→2, 재합성 `lockedSkipped:1`
  - vector(4096)
  - `.env` `UPSTAGE_API_KEY` 수정일 2026-07-27, 새 키 없이 크레딧만 재충전
- 포지션별 몫:
  - KE: `kb2.documents`/`sentences`/`sentence_versions` 데이터 모델을 설계했다. 문장 단위 임베딩의 근거는 `ingest_kb_document()`가 title+body 전체를 `embed_passage()`하는 것을 확인한 데 있다. 세목별 오케스트레이션은 `backend/api/rag/kb2_synthesis.py`에 두었다(locked 문장 보호). `retriever.py`에 `Kb2Retriever`·`HybridRetriever`(kb2 우선, 없으면 rag 폴백)를 만들고 `get_retriever(force_enabled, source)`를 확장했다.
  - BE: `supabase/migrations/0019_kb2_schema.sql`(+`kb2.match_sentences()`, 방어적 RLS)을 도쿄 Supabase에 적용했다. `kb2_store.py`(CRUD, `delete_unlocked_sentences`, `update_sentence_content`, `list_sentence_versions`)를 작성했다. `main.py`에 `POST /admin/kb2/synthesize`, `/api/chat?ragSource=`, `GET/PATCH /api/kb2/...` 5개 라우트를 추가했다. `pipeline.py`에 `rag_source_override`를 넣고 `schema.py`에 `ChatMeta.ragSource`를 추가했다.
  - AIE: `llm.py`에 `synthesize_kb2_sentences()`를 만들었다. tool-forced `emit_kb2_sentences` 출력이며, "이 경우/위와 같이" 같은 앞 문장 의존 없이 독립 완결형으로 쓰게 프롬프트로 강제했다.
  - FE: admin 쪽은 `frontend/app/admin/kb2/`, `kb2-synthesis-view.tsx`와 사이드바 "AI 코어 > 지식베이스2"를 만들었다. auditor 쪽은 `frontend/app/audit/kb2/page.tsx`와 `kb2-view.tsx`(수정/출처 보기/버전 히스토리 3버튼)를 만들었다. `services/kb2.ts`, `lib/audit-route.ts`, `audit-sidebar.tsx`도 손봤다.
  - PO: 메뉴 구조를 정했다(auditor는 수정 가능, admin은 읽기 전용). 합성 트리거는 admin 전용으로 확정했다. 대회 측 메일을 받고 API 키를 대조해 달라고 요청했다.
- 결정:
  - [PO 확정] 합성 트리거는 admin 전용이다. 기존 AI코어 파이프라인 액션과 같은 급으로 본다. 기각 대안은 auditor도 누를 수 있게 하는 안이었다. (후일담 후보)
  - [PO 확정] auditor의 수정은 제안→admin 승인 큐(`rag.passage_edits`식)를 거치지 않고 즉시 반영한다. 번복 근거는 `sentence_versions` 이력이다. 기각 대안은 승인 큐였다. (후일담 후보)
  - [구현 판단] 수정하면 그 문장의 KB 크레딧(attribution)이 편집자에게 전량 이전된다. RAG 크레딧은 원본 passage가 살아 있는 한 따로 유지한다(크레딧 2종 모델). (후일담 후보)
  - [구현 판단] 문장 단위 임베딩을 택했다. 문서 전체 임베딩은 정보 희석을 일으키기 때문이다. (후일담 후보 — KB2는 10월 폐기 예정)
  - [구현 판단] `source`가 없거나 미인식이면 기존 코드 경로를 그대로 탄다. 회귀 없음이 핵심 제약이다.
  - [구현 판단] `KB2_MIN_SCORE`를 rag 임계값과 분리했다. 응축 문장은 코사인 분포가 낮기 때문이다.
  - [구현 판단] 인증은 기존 관례대로 `editorAuditorId`를 바디로 받아 신뢰한다. 서버 측 role 검증이 없는 상태다.
- 교훈(지뢰):
  - 기존 `kb_documents`도 문서 전체 임베딩이라 같은 희석 결함을 안고 있었다. 검색은 작동하니 결함이 드러나지 않았다. 사용자 질문을 받고 코드를 확인해서 잡았다. 이제 규칙은 "청킹 단위는 문장/조항"이다.
  - kb2 매치가 0.4985로 0.50에 근소하게 미달해 검색되지 않았다. 점수 분포가 달라서 임계값에서 소리 없이 잘렸다. 실제 3-way 호출로 잡았다. 이제 규칙은 "소스별 임계값 분리"다.
  - `locked_by_auditor`를 true로 세팅하는 코드 경로가 4단계 전까지 아예 없었다. 보호 로직만 있었기 때문에 드러나지 않았다. Explore 조사로 잡았다.
- 검증: 부가가치세 합성(200 OK, 14문장, 독립 완결형 조항, `source_passage_ids` 추적, attribution 자동 채움)을 확인했다. 3-way 호출에서 기본값이 `rag`와 완전히 동일함(회귀 없음)을 확인했다. PATCH → versions → sources → 재합성 `lockedSkipped:1`까지 확인한 뒤 원복했다. 단 `locked_by_auditor`는 true로 남아 있는데, admin_revert가 생기기 전까지는 의도된 동작이다. tsc와 next build도 통과했다. 확인 못 한 것: 브라우저 수동 스모크, 17개 세목 풀 합성.
- 남은 일: 5단계 admin 뷰·번복(`admin_revert`)·배선실 "끊김 후보" 폐루프. 6단계 `ledger_entries.credit_type`, `kb2_contribution_counts()`. 전 세목 합성.
- 주의: 비밀값 없음(키 문자열은 원문에 없고 "동일하다"는 대조 결과만 있다). 설계 아티팩트 URL이 있다. KB2 관련 결정 전반(문장 단위 사전·크레딧 2종·즉시 반영)은 **후일담 후보**다. 10월 KB2 폐기·KB3로 교체.

---

### 260909_지식베이스2_AI동적카테고리재구조화.md
- 날짜 / 주차: 09-09 / W06
- 주제: KB2 설계·구축 (재구조화 하위)
- 포지션: ● KE · AIE / ○ BE · FE · PO
- 한 문단 요약: `taxonomy.py`에 하드코딩된 17개 세목(원래 Solar Pro가 도출한 산출물)을 버튼 한 번으로 Solar Pro가 RAG 전체를 다시 분석해 새로 제안하도록 바꿨다(로드맵 4.5단계). 국내 AI 트랙 취지에 맞추려는 변경이다. map-reduce로 카테고리를 발견하고, 이전 문서는 archive하며, job id 폴링으로 진행률을 보여준다. 두 차례 버그(카테고리 149개 폭주, uuid 환각)를 고친 뒤 3차 실행에서 20/20 카테고리, 17문서, 141문장을 약 35분에 성공했다. 분류 배치화·예약 실행·categories 정리는 남았다.
- 핵심 수치:
  - 활성 passage 413건, 분류는 1건=1LLM콜 순차
  - 맵 배치당 30~40건, 각 200자, `MAX_CATEGORIES=20`
  - 1차: 카테고리 149개(맵 배치 12개)
  - 2차: 37분 소요, 20개 중 11번째에서 크래시(`"152ea4c-..."` 첫 세그먼트 7자리)
  - 3차: 20/20 성공, 문서 17(3개는 passage 없음), 문장 141, 약 35분
  - auditor GET 17건, archived 11건(레거시 1 + 1차 크래시 잔여 9~10), `?ragSource=rag` 4건 히트
- 포지션별 몫:
  - KE: `backend/api/rag/kb2_taxonomy.py`를 신설했다(발견→분류 `classify_tax_category` 재사용→archive→`synthesize_kb2_sentences` 재사용). `kb2_taxonomy.py`와 레거시 `kb2_synthesis.py`에 "배치에 실제로 넣은 id 집합과의 교집합만 신뢰" 필터를 넣었다.
  - AIE: `llm.py`에 `propose_categories_batch()`(맵)와 `merge_categories()`(리듀스)를 만들고, `MAX_CATEGORIES=20`을 성공·폴백 양쪽에서 코드 슬라이스로 강제했다.
  - BE: `0020_kb2_dynamic_taxonomy.sql`(`kb2.categories` 안정 UUID, `documents.category_id` FK, `tax_category` unique 제거, `kb2.synthesis_jobs`)을 적용했다. `kb2_store.py`에 job/category/archive 함수를 추가했다. `POST /admin/kb2/restructure`(BackgroundTasks), `GET .../{jobId}`, `GET /admin/kb2/documents?status=archived`를 만들었다.
  - FE: `kb2-synthesis-view.tsx`에 "AI로 카테고리 재구조화" 섹션을 추가했다(3초 폴링, stage 라벨, 보관함). 기존 트리거는 "레거시"로 표시했다. `services/kb2.ts` 함수 3개를 추가했다.
  - PO: 트랙 취지("Upstage AI가 이해·구축")를 제기했다. 결정 2건을 내렸다.
- 결정:
  - [PO 확정] 재구조화는 매번 전체를 재생성하고, AI가 이전 카테고리와 매칭 판단을 하지 않는다. 이전 문서는 `status='archived'`로 보관한다(삭제 아님, 잠긴 문장도 보존하되 검색·화면에서는 제외). 기각 대안은 연속성 매칭이었다. (후일담 후보)
  - [PO 확정] 진행 UX는 job id + 폴링으로 한다. 레포 최초의 job/폴링 패턴이다.
  - [구현 판단] 레이블(표시용)과 정체성(category_id)을 분리했다. `tax_category` unique가 기본키 역할을 해서 레이블이 바뀌면 문서가 고아가 되기 때문이다.
  - [구현 판단] 사이드바 트리 UI는 보류하고 동적 재구조화를 먼저 했다(순서 변경).
- 교훈(지뢰):
  - 카테고리가 149개로 폭주했다. 상한을 프롬프트로만 요청했기 때문에 모델이 지키지 않아도 에러가 나지 않았다. 1차 실행에서 잡았다. 이제 규칙은 "상한은 코드에서 강제(슬라이스)"다.
  - Solar가 sourcePassageIds를 한 글자 다르게 생성해 uuid[] insert가 실패했다. 2차 실행 37분째 11번째 카테고리에서 크래시가 나서 발견했다. 이제 규칙은 "LLM 출력의 참조 필드는 실존 id 교집합으로만 DB 반영"이다. 같은 버그가 잠재해 있던 레거시 경로도 함께 고쳤다.
  - updated_at이 멈춘 것처럼 보여 스레딩을 의심했지만 실제로는 순차 분류가 느렸을 뿐이었다. FastAPI 밖 스크립트로 똑같이 느린 것을 확인해 원인을 배제했다.
- 검증: 3차 실행에서 에러 0을 확인했다. HTTP 레벨로는 auditor GET 17건, archived 11건, `?ragSource=kb2`가 새 합성 문장을 인용하는 것, `?ragSource=rag` 회귀 없음(retriever `_rag()`가 kb2_store를 import하지 않음을 코드로 확인)을 확인했다. tsc와 build도 통과했다. 확인 못 한 것: 관리자 브라우저 스모크(진행률 실시간 갱신).
- 남은 일: 분류 단계 배치화와 예약 실행(PO 우려: "세무사가 클릭 한 번으로 큰 작업에 들어가면 안 된다"), `kb2.categories` archive 누적 정리, `/audit/kb2` 트리 UI.
- 주의: 비밀값 없음. 동적 재구조화·archive 세대교체 결정은 **후일담 후보**다(KB2 10월 폐기).

---

### 260909_지식베이스2_2단트리_문장이동_편집락.md
- 날짜 / 주차: 09-09 / W06
- 주제: KB2 편집 화면·동시편집
- 포지션: ● FE · BE / ○ AIE · KE · PO
- 한 문단 요약: KB2 화면을 v1 지식베이스처럼 좌측 대목→세목 2단 트리와 우측 콘텐츠 패널로 바꿨다(로드맵 4.6단계). 여러 세무사가 동시에 편집할 때를 대비해 문장 단위 비관적 락(서버 TTL 5분, 60초 무입력 자동저장)과 문장 이동을 넣었다. 후속 작업으로 Solar Pro 대목 자동배정(17개 중 16개 배정, 대목 6개), 롱프레스 버그 수정과 Playwright 첫 실브라우저 검증, UI 4건 개편을 했다. UI 4건은 그룹 이동 [확정], 클릭으로 이동, 배지 위치, 문장 연결 끊기/재연결(0022)이다. 남은 것은 대목/세목 삭제 UI와 모바일 터치 확인이다.
- 핵심 수치:
  - 락 TTL 5분, 무입력 자동저장 60초, 라우트 9개 추가
  - TTL 테스트: 락 타임스탬프를 6분 전으로 강제한 뒤 재획득에 성공
  - 기존 활성 세목 17개 회귀 없음(groupId 전부 null)
  - 자동배정: 대목 6개 생성, 16/17 배정, 1건("유튜브콘텐츠제작비용처리") 누락
  - 대목 제안 3~8개
  - 롱프레스 테스트: 700ms면 다이얼로그가 뜨고, 100ms 대조군은 뜨지 않음. 콘솔 에러 0
- 포지션별 몫:
  - FE: `frontend/hooks/use-long-press.ts`를 신설했다(레포 최초, Pointer Events). 이후 `setPointerCapture`를 넣어 고쳤다가, 클릭 방식으로 바꾸면서 삭제했다. `kb2-view.tsx`를 대규모로 개편했다: 2단 트리, 다이얼로그 4곳(`ui/dialog.tsx` 첫 실사용), 락 배지 "OOO님이 수정 중", 60초 타이머, 언마운트 시 락 해제, `groupChoiceDraft`+[확정], `StatusReasonDialog`(사유 필수), 배지 위치 이동, Wand2 자동배정 버튼.
  - BE: `0021_kb2_groups_and_locks.sql`(`kb2.groups`, `documents.group_id`, `sentences.locked_by`/`lock_acquired_at`, `editor_type 'moved'`+`meta jsonb`)을 작성했다. `0022_kb2_sentence_status.sql`(`sentences.status` active/retired, `'retired'`/`'reconnected'`, `match_sentences()`에 `s.status='active'` 필터)도 작성했다. `kb2_store.py`에 `acquire_lock`/`release_lock`(`effectively_locked`), `move_sentence`, `set_sentence_status`를 추가했다. `POST /api/kb2/sentences/{id}/status`와 `POST /api/kb2/documents/auto-group`을 만들었다.
  - AIE: `llm.py`에 `propose_document_groups()`를 만들었다. 세목 제목만 넣고 tool-forced로 호출하며, `documentIds`를 실존 id enum으로 제한해 환각을 막았다.
  - KE: `kb2_taxonomy.auto_group_ungrouped_documents()`를 만들었다(`group_id is null`만 대상). `kb2.groups`는 AI 파이프라인과 무관한 순수 UI 정리 계층으로, `kb2.categories`와 별개 개념이다.
  - PO: 확인 2건을 했다(기존 20개 세목도 그룹 편입 가능하게, 락 강제해제 방식). UI 피드백 4건을 줬다.
- 결정:
  - [PO 확정] 락 자동해제는 하트비트 없이 서버 TTL(5분)로 한다. 다음 사람이 획득을 시도할 때 덮어쓴다. 0012/0013의 영구 상태전이형 락은 성격이 달라 재사용하지 않았다.
  - [PO 확정] 기존 AI 합성 세목도 "그룹 지정"으로 언제든 재배치할 수 있다.
  - [구현 판단] 이동·이름수정·그룹지정은 원자적 단발 작업이라 락을 걸지 않는다. 텍스트 편집만 락 대상이다.
  - [구현 판단] 문장을 이동해도 attribution은 유지한다. 이동은 분류 정리이지 내용 수정이 아니기 때문이다.
  - [구현 판단] 이동은 DnD가 아니라 다이얼로그 피커로 한다(레포에 DnD 라이브러리가 없음). 롱프레스로 시작했다가 클릭으로 바꿨다.
  - [구현 판단] 대목 분류표를 하드코딩하지 않고 Solar Pro가 판단하게 했다. 국내 AI 트랙 취지 때문이다. 17건뿐이라 map-reduce는 필요 없었다.
  - [PO 확정] 그룹 재배치는 [확정] 버튼을 눌러야 반영된다(되돌리기 어려운 큰 변경). 연결 끊기는 사유 필수이며 삭제가 아니다(배선실 철학).
  - [구현 판단] 자동배정 결과는 롤백하지 않고 프로덕션에 그대로 반영했다.
  - (KB2 화면 결정 전반: 후일담 후보)
- 교훈(지뢰):
  - 손잡이를 눌러도 반응이 없었다. 히트 영역이 작아 살짝만 움직여도 `onPointerLeave`가 타이머를 조용히 취소했다. 사용자 피드백으로 알았고, pointer capture를 넣고 leave 핸들러를 제거해 고쳤다. 결국 롱프레스를 버리고 클릭으로 갔다.
  - 안 쓰이는 `didFire`가 스프레드로 DOM에 새어 React 경고가 났다. 죽은 코드라 아무도 보지 않던 곳이었고, 수정하면서 제거했다.
  - Turbopack이 이 Windows 환경에서 postcss 서브프로세스 스폰에 실패해 크래시가 났다. `npx next dev --webpack`으로 우회했다.
  - 자동배정 1건이 누락됐다. 모델이 놓친 것이며, "미분류만 재대상" 설계 덕분에 다시 누르면 재시도된다.
- 검증: tsc와 next build를 통과했다. 프로덕션 Supabase에 대해 curl로 대목/세목 CRUD, 락 A/B/C 시나리오, 이동 v1→2 `meta` from/to, TTL 회수, 상태 끊기/재연결 이력을 확인했다. Playwright로 롱프레스 700ms/100ms, UI 4건을 확인했고 콘솔 에러는 0이었다. 테스트로 바꾼 상태는 복구했다. 확인 못 한 것: 롱프레스와 모바일 터치 스크롤의 충돌(클릭 전환 전 기준), 탭을 완전히 닫는 경우(서버 TTL에 의존).
- 남은 일: 세목 단위 동시수정 락 검토, 대목/세목 삭제 UI, 모바일 실사용 테스트.
- 주의: 비밀값 없음(로그인 계정명 auditor2만 언급). KB2 UI·락·그룹 체계는 **후일담 후보**다.

---

### 260910_지식베이스2_분류배치화_야간예약_삭제UI.md
- 날짜 / 주차: 09-10 / W06
- 주제: KB2 재구조화 운영화(배치·예약·타임아웃)
- 포지션: ● BE · KE / ○ AIE · FE · PO · EV
- 한 문단 요약: 로드맵 §7 후보 1~5번을 모두 처리했다. 분류를 배치 20건으로 바꿔 413건 기준 약 5.6분을 약 2.8분으로 줄였고, 그 과정에서 SDK 기본 타임아웃 폭주(1250초)를 발견해 90초 상한을 걸었다. 재구조화 트리거를 DB 예약과 백엔드 폴러 방식의 "야간 03:00 예약"으로 바꿨다. 쌓인 카테고리 잔해 14개를 정리하고(0023), 세목 연결 끊기와 대목 삭제를 추가했다(0024). 문서 단위 편집 락은 불필요하다고 결론 내렸고, 그 대신 대목 삭제 레이스 구멍을 막았다. 예약 실발화는 같은 날 후속 문서에서 확인됐다.
- 핵심 수치:
  - 413건. 건별 0.82s(약 5.6분), 배치20 0.41s(약 2.8분), 배치60 0.34s(약 2.3분)
  - 배치40 한 배치가 1250초(600+600+50, 타임아웃 600s×재시도 2회). 20건 8.2초, 60건 20.1초
  - 상한 90초 + 재시도 1회, 배치 크기 20 채택
  - 로드맵의 "35분"은 파이프라인 전체였던 것으로 보이며, 분류만은 5~6분대
  - 카테고리 활성 31 vs 문서 17. 정리 후 활성 17 / 보관 14
  - 폴러 1분 주기, `uvicorn --workers 1`
  - Playwright 22건(예약 8 + 세목/대목 12 + 레이스 2), 콘솔 에러 0. curl 6건, claim 원자성 4건
  - 커밋 `faf8733`(1~3번), `a91465a`(4~5번), 마이그레이션 0023·0024
  - 분류 품질 표본 5건(1건 불일치)
- 포지션별 몫:
  - AIE: `llm.classify_passages_batch(passages, categories)`를 만들었다. id를 enum으로 주고, 지어낸 id는 필터로 걸렀다.
  - KE: `kb2_taxonomy._classify_all`에서 누락분은 건별로 보충하고, 배치가 실패하면 빈 dict로 받아 자동 폴백되게 했다(정확도는 건별과 같고 시간만 준다). `archive_all_active_categories()`를 추가하고 0023으로 잔해를 소급해 archived로 전환했다.
  - BE: `backend/api/rag/kb2_scheduler.py`(FastAPI lifespan 폴러)를 만들었다. `synthesis_jobs.status='scheduled'`+`scheduled_at`을 두고, claim은 단일 `UPDATE … WHERE status='scheduled'` + `FOR UPDATE SKIP LOCKED`로 처리했다. 엔드포인트 `/restructure`(scheduleAt), `/restructure/scheduled`, `/{id}/cancel`을 만들었고 라우트 순서에 주의했다. 0024로 세목 `'retired'`와 `kb2.document_events`를 추가했고, 목록 쿼리에 `left join lateral` 최신 이벤트를 얹었다. 배포는 백엔드 먼저, main은 나중에 했다.
  - FE: 진행률 단위 표기를 단계별로 교정했다. 기본 액션을 `[오늘 밤 03:00 실행 예약]`으로 바꾸고, 즉시 실행은 확정형으로, 예약 취소와 복원을 넣었다. 다음 03:00의 epoch ms는 브라우저(KST)에서 계산한다. 끊긴 세목은 옅게 표시하고 링크 아이콘을 붙였다. 대목 삭제는 확인 다이얼로그를 거친다. 살아 있지 않은 `group_id`는 "미분류"로 간주한다(트리 전사).
  - PO: "세무사가 버튼 한 번으로 큰 작업에 들어가면 안 된다"고 지적했다. 세목과 대목에 서로 다른 수단을 쓰는 것을 확인했다.
- 결정:
  - [PO 확정] 세목은 연결 끊기/재연결(지식이 든 그릇), 대목은 삭제(지식 없는 정리 계층, 속한 세목은 미분류로 풀림)로 한다. 기각 대안은 둘 다 "삭제 UI"로 두는 것(로드맵 원안)이었다.
  - [PO 확정] 트리거 기본값은 야간 예약이고, 즉시 실행은 확정형으로 둔다.
  - [구현 판단] pg_cron을 쓰지 않고 DB 예약 + 백엔드 폴러로 갔다. 본체가 Upstage 호출(Python)이라 DB가 스스로 못 하고, pg_net으로 깨우면 부품만 는다. 기각 대안은 pg_cron(0006 선례)이었다.
  - [구현 판단] 배치 크기는 20이다. 60이 근소하게 빠르지만 폭주·폴백 비용이 배치 크기에 비례한다.
  - [구현 판단] 상태값은 `'archived'`가 아니라 새 값 `'retired'`로 했다. archived는 이미 "재구조화 세대교체"라는 뜻으로 쓰이고 있다(0020).
  - [구현 판단] 사유는 문서 row 컬럼이 아니라 별도 `document_events` 테이블에 쌓는다. 마지막 사유만 남으면 이력을 따라갈 수 없다.
  - [구현 판단] 문서 동시수정 락은 불필요하다. 단일 UPDATE라 잃는 것이 이름 한 줄뿐이다.
  - (KB2 운영 결정 전반: 후일담 후보)
- 교훈(지뢰):
  - 배치 하나가 1250초를 먹었다. SDK 기본값(600s×2회 재시도)이 조용히 살아 있었다. 실측 표에서 튄 값을 보고 잡았다. 이제 규칙은 "LLM 호출마다 명시적 상한 + 폴백"이다.
  - 로드맵의 "35분"이라는 수치를 오독할 뻔했다. 측정 범위가 달랐다. 고치기 전에 측정부터 해서 잡았다. 이제 규칙은 "추정으로 고치지 않는다"다.
  - 카테고리 잔해가 31 vs 17로 쌓였다. 기능에는 영향이 없어 드러나지 않았고, 실측으로 잡았다.
  - 대목 삭제와 세목 이동이 경합하면 세목이 화면에서 통째로 사라진다. 트리가 활성 대목만 그리기 때문에 조용했다. 설계 검토 중에 발견해 raw SQL로 레이스를 재현해 확인했다. 이제 규칙은 "죽은 참조는 미분류로 표시(전사)"다.
  - 배포 순서: 프론트가 먼저 나가면 "예약" 버튼이 구 백엔드에서 즉시 실행으로 동작한다. 구 엔드포인트가 body를 무시하기 때문에 조용하다. 백엔드를 먼저 배포한다.
  - 서버가 도쿄 박스라 서버 로컬 시간으로 "새벽 3시"를 해석하면 어긋난다. 시각은 브라우저(KST)에서 계산한다.
- 검증: 프로덕션 Supabase에 직결해 검증하고 데이터는 원복했다. 마이그레이션 2건, curl 6건, claim 원자성 4건, 세목 상태 왕복과 이력 2건 보존, Playwright 22건을 확인했다. 확인 못 한 것: 야간 예약의 실제 발화(→ 후속 문서에서 해소), 분류 품질(표본 5건뿐), `document_events` 전체 이력 화면 없음. 커밋 `a91465a`는 기록 시점에 배포 전이었다.
- 남은 일: `document_events` 이력 화면, 분류 품질 표본 확대.
- 주의: 비밀값 없음. KB2 재구조화 운영 결정은 **후일담 후보**다.

---

### 260910_지식베이스2_재구조화최초실행_타임아웃전수적용_커버리지20퍼센트발견.md
- 날짜 / 주차: 09-10 / W06
- 주제: KB2 재구조화 운영화(배치·예약·타임아웃) — 커버리지 문제 발견
- 포지션: ● BE · KE / ○ AIE · PO · RS · EV
- 한 문단 요약: 야간 예약 경로를 프로덕션에서 처음 실제로 발화했고(예약시각 +60초에 claim), 정상 동작했다. 하지만 맵 단계가 SDK 기본 타임아웃에 물려 21분 동안 교착됐다. 이를 계기로 상한 없는 LLM 호출 10곳을 `bounded_client`로 전수 정리하고, stale job 회수와 리퍼 오살 버그를 고쳤다. 재실행은 822초에 완주했다(카테고리 20·문서 20·문장 176). 그런데 KB2가 원본 413건 중 83건(20%)만 담고 있다는 더 큰 문제가 드러났다. 원인은 맵 프롬프트가 주제가 아니라 질문 요약을 뽑는 데 있다. PO 지시로 논문 세션과 제품 세션을 분리하는 정책(HF 정책 §5)도 신설했다.
- 핵심 수치:
  - 예약: +0s scheduled → +178s running(예약시각 +60초)
  - 맵 교착 21분(SDK 기본 600s×재시도 2회 = 최대 30분)
  - 상한 없는 호출 10곳. 맵/리듀스/분류배치/대목배정 90s(리듀스는 이후 600s), 단건 분류 30s, 합성 240s, 임베딩 30s, 챗 추출 60 / 판정문 120 / 자문 120 / 검증 60 / 되묻기 90
  - `STALE_JOB_MS` 15→30분. 불변식: 최악 침묵 20분 < 30분
  - 재실행 822초(13.7분): 맵 12배치 88초, 리듀스 186초(폴백), 분류 21배치 156초(413건 2.6분, 건별 추정 5.6분), 합성 20개 391초
  - 결과: 카테고리 20, 문서 20, 문장 176(이전 판 17문서/92문장)
  - 커버리지 413 중 83(20%, 하한). 상위 3개 카테고리는 15문장씩, 최하위는 2문장
  - 추출 비결정성: 같은 질문 5회에 `etype` 2/5 vs 3/5(temperature=0)
  - 커밋 `84463c3`, `+α`
- 포지션별 몫:
  - BE: `llm.bounded_client(timeout, retries=1)` 헬퍼를 만들어 10곳에 전부 적용했다(모두 try/except 폴백이 있음을 확인). stale job 회수는 두 갈래로 했다: 기동 직후 1회(`--workers 1` 전제), 평시에는 갱신 없는 running을 error로. 로그 `[kb2_scheduler] 재시작으로 중단 — job 1건 정리`로 확인했다. 리퍼 오살 버그는 `STALE_JOB_MS` 30분과 폴백 루프의 건별 심장박동으로 고쳤다.
  - KE: 맵 진행률(`0/12 → 12/12`)을 job에 기록하게 했다. 9/9판과 9/10판 아카이브를 대조했다. 커버리지 20%를 측정했다(`valid_source_ids` 필터 때문에 하한값). 원인이 `llm.propose_categories_batch` 프롬프트임을 진단했다.
  - AIE: 챗 경로의 상한을 정했다(`embed_query`, `write_advisory`가 사용자 요청 경로). 추출 비결정성을 관측했다.
  - PO: 논문과 제품 세션 분리를 지시했다. `docs/doing/HF_사용정책_국내AI트랙.md` §5를 신설했다(로컬 전용). 7월 Claude 채점은 논문 투고용이라 문제없다고 정정했다.
  - RS: 3방향 비교(무RAG/기존RAG/KB2)가 구조적으로 가능함을 프로덕션 실호출로 확인했다(`?rag=` × `?ragSource=` 직교). 벤치마크 실행은 논문 세션으로 넘겼다.
- 결정:
  - [PO 확정] 논문·벤치마크·채점은 별도 세션에서 하고, 이 세션은 제품 코드 전용이다. 트랙 판정 대상은 제품 구동 경로 안의 추론 호출이다. 오프라인 예외는 좁게 둔다(연구로 명시된 스코프 / 대회 제출물 아님 / 런타임 미import, 셋 다 만족해야 함). 제품 세션에서는 이 예외를 적용하지 않는다.
  - [PO 확정] `backend/bulk_ask_multi.py`(ICTC 2×3 교차모델 실험, 외산 호출)는 삭제 금지이며 처리는 논문 세션 사안이다.
  - [구현 판단] 모든 LLM 호출에 상한을 둔다. 상한은 정확도를 깎지 않고 최악 시간만 자른다.
  - [구현 판단] stale 기준값의 원칙을 주석에 명문화했다: "정상 진행 중 가능한 최장 침묵보다 넉넉히".
  - [구현 판단] 맵 프롬프트 개선은 KB2 전체를 다시 만드는 변경이라 이 세션에서 하지 않고 다음으로 넘긴다. 그 전에 분류 분포 계측을 먼저 넣는다. (후일담 후보)
  - 기각: merge 상한을 올리고 재실행하자는 안. 대조군 확인 결과 카테고리 품질과 무관했다.
- 교훈(지뢰):
  - 맵 단계가 21분 교착됐다. 배치화 때 분류에만 상한을 걸었고, 맵은 배치마다 job을 갱신하지 않아 "정상 진행"과 "폭주"가 구분되지 않았다. 21분 무진전을 관찰해 잡았다. 이제 규칙은 "관측 불가능한 구간을 만들지 말 것, 상한은 전수 감사"다.
  - 배포(`systemctl restart`)나 크래시가 job을 영구 `running`으로 남긴다. 아무도 꺼내주지 않아 화면이 끝없이 "재구조화 중"이다. 교착된 판을 배포로 끊으면서 확인했다. 이제 규칙은 "기동 시 회수 + 평시 리퍼"다.
  - 즉시 실행 경로에서 리퍼가 살아 있는 job을 죽일 수 있었다. 예약 경로는 `to_thread`에 막혀 안전해서 문제가 보이지 않았다. merge 상한 값을 계산하다가 발견했다. 이제 규칙은 "최악 침묵 < stale 기준" 불변식을 확인하는 것이다.
  - merge 타임아웃 때문에 카테고리 품질이 나쁘다고 인과를 단정할 뻔했다. 대조군(9/9판)을 보지 않았기 때문이다. 아카이브를 대조해 두 판이 거의 같은 질문 제목 목록임을 확인했다. 이제 규칙은 "재실행을 권하기 전에 대조군 확인"이다.
  - 커버리지가 20%였다. 파이프라인은 에러 없이 완주했고, 분류 결과를 저장하지 않아 미분류가 보이지 않았다. 출처 passage를 집계해서 잡았다. 이제 규칙은 "분류 분포를 job result에 계측"이다.
  - 되묻기 분기는 검색 전에 리턴해 `ragSource` 값이 없다. 그래서 로그에서 "KB2 0건"과 "검색 안 함"이 구분되지 않는다. `not_retrieved`를 명시해야 한다.
- 검증: 예약 실발화, 822초 완주, 단계별 소요, 맵 진행률, stale 회수 로그, 활성 문서 17개 무손상(보관은 분류 이후 단계라서)을 확인했다. 런타임 `backend/api/`는 깨끗하다(`OpenAI(...)`는 `llm.get_client()` 하나뿐, base_url은 Upstage 고정). 확인 못 한 것: 미분류 건수 직접 측정(assignment 미저장), §3 CI 정적 검사(미구현이며 방어선은 문서와 사람 주의력뿐).
- 남은 일: 맵 단계 프롬프트 개선(본체), 분류 분포 계측(선행), 3방향 벤치마크(논문 세션), 되묻기 분기 `not_retrieved`, 추출 비결정성 대응(논문 세션).
- 주의: 비밀값 없음. HF 정책 문서는 docs/ 미추적 로컬 전용이다. 커버리지·맵 프롬프트 결정은 **후일담 후보**다(KB2 10월 폐기, 이후 "커버리지=계기판 천장 63~65%"로 이어짐).

---

## 이 파트의 주제 묶음

- **검수 데이터 정리(운영 DB 정리)** → 260831_미확정검수데이터_논문오인정정_submitted감사52건삭제.md
- **KB2 설계·구축** (문장 단위 사전·스키마·합성·검색 전환·AI 동적 재구조화) → 260909_지식베이스2_설계_스키마_합성파이프라인_검색전환.md, 260909_지식베이스2_AI동적카테고리재구조화.md
- **KB2 편집 화면·동시편집** (2단 트리·락·이동·연결 끊기) → 260909_지식베이스2_2단트리_문장이동_편집락.md (+ 260910_분류배치화 §4~5의 세목 끊기/대목 삭제 UI가 겹침)
- **KB2 재구조화 운영화(배치·예약·타임아웃)** → 260910_지식베이스2_분류배치화_야간예약_삭제UI.md, 260910_지식베이스2_재구조화최초실행_타임아웃전수적용_커버리지20퍼센트발견.md
- 곁가지 주제(단독 문서 없음, 다른 파트와 합칠 후보): **국내 AI 트랙 준수·세션 분리 정책** ← 260910_재구조화최초실행 §9 / **Upstage API 키 확인(대회 결선 인프라)** ← 260909_설계 §3
