# 세무사 연결 잔여 정리 — Realtime 유실 해소 · 프로필 사진 업로드

- 날짜: 2026-09-21
- 커밋: `672d16b` (main push → Vercel 반영 확인)
- 마이그레이션: `0036_expert_avatar_storage.sql` (적용 완료)
- 설계 마스터: `docs/doing/세무사연결_핸드오프_이식설계.md` §5

## 배경
오라클 유료 서버 이관으로 넘어가기 전에, 세무사 연결 기능의 잔여 항목을 털고 가기로 했다.
사용자 결정 두 가지:
- **인앱 상담 채팅(사장님↔세무사 메시지 스레드)은 보류.** 팀에서 기획을 더 봐야 하고, 만들어 놓고 안 쓸 위험이 있다.
  지금은 수락 후 연락처(전화·이메일·카카오 오픈채팅)로 앱 밖에서 잇는다.
- **별점 불필요.** 하트로 충분.

## ① Realtime 유실 — "기존 문제"로 미뤄 뒀던 자리의 진짜 원인
(b) 세션에서 "Realtime 이 구독 전에 생긴 대화를 놓친다"로 관찰만 하고 범위 밖으로 뒀던 문제.

원인은 `frontend/lib/supabase/sync.ts` 의 **순서**였다. `makeCollectionSync` 가
`전체 fetch → setAll → 그다음 구독` 이라, fetch 스냅샷 시점과 구독 시작 사이에 들어온 INSERT 는
어느 쪽에도 안 잡혀 **다음 재적재까지 영구 유실**된다. 대화만의 문제가 아니라 모든 컬렉션 공통이었다.

고친 순서: **구독(SUBSCRIBED 확인) → fetch → setAll → 버퍼 적용**.
- 적재 중 도착한 이벤트는 버퍼에 쌓았다가 스냅샷 뒤에 순서대로 적용한다.
  유실은 회복 불가지만 겹침은 upsert 가 멱등이라 무해 — 겹치는 쪽을 택한다.
- 인증 이벤트(SIGNED_IN/OUT/TOKEN_REFRESHED)에는 채널 자체를 새 토큰으로 갈아끼운다.
  `postgres_changes` 의 RLS 는 join 시점 토큰으로 평가되므로, anon 으로 붙은 채널은
  로그인 뒤에도 본인 행을 못 받는다.
- 구독 확정은 5초 타임아웃으로 풀어 준다(Realtime 이 막혀 있어도 적재는 진행).

### 재현이 먼저였다
첫 시험은 "로그인 → 3초 대기 → 다른 기기에서 INSERT → 사이드바 확인"이었는데,
**고치기 전 코드에서도 통과**했다. 3초를 기다린 탓에 구독이 이미 붙은 뒤였고, 경합을 안 건드린 것이다.
Playwright `route` 로 conversations 최초 적재의 **응답을 붙잡고** 그 사이에 다른 세션이 INSERT 하도록 바꾸자
- 고치기 전: **유실**
- 고친 뒤: **2회 연속 보임**

재현되지 않는 수정은 무엇을 고쳤는지도 알 수 없다. A/B 를 남긴다.

### 회귀
공용 유틸이라 역할 3종 9화면 스모크: owner(/consultations, /chat/clinic),
auditor(/audit/work, /audit/consultations, /audit/profile, /audit/kb-map),
admin(/admin/consultations, /admin/inspection, /admin/mail) → 9/9, 적재 고착·빈 화면·page error 0.

`conversation-store.fetchConversationRecord` 폴백은 그대로 둔다 — 특정 대화를 꼭 열어야 하는
화면(상담 상세, `?c=`)의 안전망이라 성격이 다르다.

## ② 세무사 프로필 사진 업로드
`0036`: 버킷 `expert-avatars`(공개 읽기, 1MB, image/webp·png·jpeg).
쓰기는 `<auditor_id>/` 본인 폴더만(`storage.foldername(name)[1] = public.current_domain_id()`),
관리자는 아무 사진이나 내릴 수 있다(운영 브레이크).

- 브라우저에서 **256px 정사각 webp 로 재인코딩**해 올린다: 카드 표시 크기가 48px 남짓이고,
  비로그인 방문자도 받는 자원이며, 재인코딩에서 EXIF(촬영 위치 등)가 떨어져 나간다.
- 파일명은 epoch — 교체할 때마다 URL 이 바뀌어 CDN 이 옛 사진을 물지 않는다.
- **업로드 ≠ 반영.** [저장]을 눌러야 카드에 붙고, 저장이 확정된 뒤에만 버려진 객체를 버킷에서 지운다.
  (업로드 즉시 지우면 "저장 안 하고 나가기"로 되돌릴 사진이 없다.)

### 권한 실측 (Storage API 경로)
본인 폴더 업로드 200 / 남의 폴더 403 / 사장님(user) 403 / 공개 URL 비로그인 200 /
남의 사진 삭제 403 / 본인 삭제 200 / 관리자 삭제 200.

**함정:** `storage.objects` 에 직접 SQL DELETE 를 하면 Supabase 가 트리거로 막는다
("Direct deletion from storage tables is not allowed. Use the Storage API instead").
그래서 삭제 정책은 SQL 시뮬레이션으로 검증되지 않는다 — 반드시 API 경로로 확인할 것.
배치 삭제(`DELETE /object/<bucket>` + prefixes)는 권한이 없어도 **200 에 빈 배열**을 돌려주므로
상태 코드만 보면 통과로 오독한다. 행이 실제로 사라졌는지 SQL 로 확인해야 한다.

### 종단
세무사 업로드 → 저장 → 새로고침 유지 → 사장님 채팅 카드에 그 사진(공개 URL 일치).

## 정리
E2E 가 만든 대화 9·`rag.chat_turns` 2·업로드 객체 1 삭제, 데모 프로필 `auditor` = preset-1 원복.
tsc 0 · lint 0 · build ✓.

## 남은 것
- 인앱 상담 채팅 — 보류(팀 기획).
- 업로드 사진의 관리자 심사 화면 — 정책(관리자 삭제)만 있고 화면은 없다.
- 다음: **오라클 유료 서버 이관**(`docs/doing/260916_Oracle유료이관_착수계획.md`). 사용자 확인: 오라클 쪽 준비 완료.
