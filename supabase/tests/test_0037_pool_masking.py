"""0037 비식별 상담사 풀 — 마스킹 단위시험(양성·음성) + 역할별 RLS. 모든 쓰기는 트랜잭션 안에서 하고 롤백한다.

사용 (저장소 루트에서):
    backend/.venv/Scripts/python.exe supabase/tests/test_0037_pool_masking.py --applied
      --applied            적용된 DB 의 함수 그대로 시험 (보통 이것)
      --applied --refn-all 파일의 함수 정의로 바꿔 끼운 뒤 시험 — 규칙을 고칠 때 적용 전에 돌린다
      --applied --fresh    0037 객체를 전부 지우고 파일 전체를 다시 실행해 시험(깨끗한 DB 재현)
      (옵션 없음)          0037 미적용 DB 에서 파일 전체를 실행해 시험
규칙을 고치면 POSITIVE/NEGATIVE 에 사례를 더하고, 실데이터 오탐도 확인한다(설계 §11 2026-09-21).
"""
import json, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "supabase"))
from apply_migration import db_url  # noqa: E402
import psycopg  # noqa: E402

APPLIED = "--applied" in sys.argv
SQL = (REPO / "supabase/migrations/0037_pool_consents_masking.sql").read_text(encoding="utf-8")

UID = {
    "viewer": "11111111-1111-1111-1111-111111111111",
    "auditor": "22222222-2222-2222-2222-222222222222",
    "admin": "33333333-3333-3333-3333-333333333333",
    "auditor2": "44444444-4444-4444-4444-444444444444",
    "owner2": "55555555-5555-5555-5555-555555555555",
}

# (입력, 기대 출력, 기대 리포트)
POSITIVE = [
    ("연락처는 010-1234-5678 입니다", "연락처는 [전화] 입니다", {"전화": 1}),
    ("01012345678로 전화", "[전화]로 전화", {"전화": 1}),
    ("병원 02-555-1234, 지점 031)123-4567", "병원 [전화], 지점 [전화]", {"전화": 2}),
    ("메일 kim.dr@clinic.co.kr 로", "메일 [이메일] 로", {"이메일": 1}),
    ("사업자번호 123-45-67890 입니다", "사업자번호 [사업자번호] 입니다", {"사업자번호": 1}),
    ("주민번호 850101-1234567", "주민번호 [주민번호]", {"주민번호": 1}),
    ("국민은행 123456-01-234567 로 입금", "국민은행 [계좌] 로 입금", {"계좌": 1}),
    ("계좌는 신한 110-123-456789", "계좌는 신한 [계좌]", {"계좌": 1}),
    ("카드 1234-5678-9012-3456 결제", "카드 [카드] 결제", {"카드": 1}),
    ("서울특별시 강남구 테헤란로 123 3층", "[주소] 3층", {"주소": 1}),
    ("강남구 역삼로 45-6에 있어요", "[주소]에 있어요", {"주소": 1}),
    ("역삼동 123-4번지", "[주소]", {"주소": 1}),
    ("저는 강남미소치과 원장입니다", "저는 [상호] 원장입니다", {"상호": 1}),
    ("해피한의원에서 일해요", "[상호]에서 일해요", {"상호": 1}),
    ("미소치과의원을 운영", "[상호]을 운영", {"상호": 1}),
    ("김철수 원장님이 말하길", "[이름] 원장님이 말하길", {"이름": 1}),
    ("박영희대표가 김철수 원장에게", "[이름]대표가 [이름] 원장에게", {"이름": 2}),
    ("홍길동씨와 상의, 홍길동이 결정", "[이름]씨와 상의, [이름]이 결정", {"이름": 2}),
    ("남궁민수 실장", "[이름] 실장", {"이름": 1}),
    ("김하은원장과 이지은 대표", "[이름]원장과 [이름] 대표", {"이름": 2}),
    ("저는 원장 김철수입니다", "저는 원장 [이름]입니다", {"이름": 1}),
    ("대표 박영희, 실장 최민수", "대표 [이름], 실장 [이름]", {"이름": 2}),
]

NEGATIVE = [
    "매출이 1,000-2,000만원 사이입니다",
    "3,000,000원, 1억 2천만 원",
    "2023-2024년 귀속분, 2024년 5월",
    "2024-01-15에 국민은행에서 이체했습니다",
    "소득세법 제33조 제1항 제2호, 법인세법 시행령 제19조의2",
    "조특법 제126조의2 및 대법원 2019두12345, 조심2020서1234",
    "세율은 6-45%, 0.010 비율",
    "치과 개원 3년차, 병원 운영비",
    "한의원과 종합병원, 국회의원, 치과의원, 동물병원",
    "동의원칙에 따라",
    "사장님, 고객님, 선생님",
    "공동대표 두 명, 이번 대표님, 기존 원장님",
    "여러분 대표로",
    "강남에서 15년 된 치과",
    "강남구 기준으로 3곳",
    "연간 급여 5,000만원, 직원 12명",
    "필요경비 60% 공제, 4대보험",
    "휴게 공간이 원장 개인 거주, 명의가 원장님 개인, 방식과 원장님",
    "우리병원 대학병원인데요",
    "세무사 연결해 주세요, 원장 연결해. 대표 상담해, 원장 김철수 입니다",
    "원장 개인 거주, 원장 본인의, 원장 단독 수혜, 원장 소득이, 원장 명의로, 대표 이사",
]


def main():
    ok = fail = 0

    def check(label, cond, detail=""):
        nonlocal ok, fail
        if cond:
            ok += 1
        else:
            fail += 1
            print(f"  FAIL {label} {detail}")

    with psycopg.connect(db_url()) as conn:
        cur = conn.cursor()
        if "--fresh" in sys.argv:
            cur.execute("""drop function public.grant_pool_consent(text); drop function public.revoke_pool_consent(text);
              drop table public.pool_case_views; drop table public.conversation_pool_consents;
              drop function public.list_pool_cases(); drop function public.open_pool_case(text);
              drop function public.preview_pool_mask(text); drop function public.mask_conversation_payload(jsonb);
              drop function public._pool_mask_jsonb(jsonb, text); drop function public._pool_report_add(jsonb, jsonb);
              drop function public._pool_mask_text(text);""")
            cur.execute(SQL)
            print("[dryrun] 0037 객체 전부 drop → 파일 전체 재실행(트랜잭션 안)")
        elif not APPLIED:
            cur.execute(SQL)
            print("[dryrun] 0037 실행(트랜잭션 안)")
        elif "--refn-all" in sys.argv:
            i = SQL.index("create or replace function public._pool_mask_text")
            cur.execute("drop function if exists public.list_pool_cases()")
            cur.execute(SQL[i:])
            print("[dryrun] 함수 전부 교체(트랜잭션 안)")
        elif "--refn" in sys.argv:
            i = SQL.index("create or replace function public._pool_mask_text")
            j = SQL.index("-- ── ④ 동의")
            cur.execute(SQL[i:j])
            print("[dryrun] _pool_mask_text 만 교체(트랜잭션 안)")

        print("── 마스킹 양성")
        for text, want, rep in POSITIVE:
            cur.execute("select masked, report from public._pool_mask_text(%s)", (text,))
            got, report = cur.fetchone()
            check(f"+ {text!r}", got == want and report == rep, f"→ {got!r} {report}")
        print("── 마스킹 음성")
        for text in NEGATIVE:
            cur.execute("select masked, report from public._pool_mask_text(%s)", (text,))
            got, report = cur.fetchone()
            check(f"- {text!r}", got == text and report == {}, f"→ {got!r} {report}")

        # jsonb 재귀: 구조 키 보존 + 문자열 잎 마스킹 + 리포트 합산
        payload = {
            "id": "live-clinic-010-1234-5678",
            "schemaVersion": "1",
            "persona": {"occupation": "clinic", "label": "사장님", "businessType": "치과"},
            "topic": {"title": "강남미소치과 인건비", "taxCategory": "소득세", "caseRefs": [], "frameworks": []},
            "starterQuestions": [{"id": "s1", "text": "q"}],
            "messages": [
                {"id": "m1", "role": "user", "order": 0,
                 "segments": [{"id": "g1", "type": "question",
                               "text": "강남미소치과 원장 김철수입니다. 010-1234-5678"}]},
                {"id": "m2", "role": "assistant", "order": 1,
                 "segments": [{"id": "g2", "type": "rule_statement", "text": "소득세법 제33조에 따라"}],
                 "uiBlocks": [{"kind": "expert_handoff", "reason": "문의 kim@a.com"}]},
            ],
        }
        cur.execute("select public.mask_conversation_payload(%s::jsonb)", (json.dumps(payload),))
        res = cur.fetchone()[0]
        mp = res["payload"]
        check("json id 보존", mp["id"] == payload["id"])
        check("json role/type/kind 보존",
              mp["messages"][0]["role"] == "user" and mp["messages"][0]["segments"][0]["type"] == "question"
              and mp["messages"][1]["uiBlocks"][0]["kind"] == "expert_handoff")
        check("json order 숫자 보존", mp["messages"][1]["order"] == 1)
        check("json persona 계정표시명 중화", mp["persona"]["label"] == "[고객]" and mp["persona"]["businessType"] == "[고객]"
              and mp["persona"]["occupation"] == "clinic")
        check("json 본문 마스킹", mp["messages"][0]["segments"][0]["text"] == "[상호] 원장 [이름]입니다. [전화]",
              mp["messages"][0]["segments"][0]["text"])
        check("json 제목 마스킹", mp["topic"]["title"] == "[상호] 인건비", mp["topic"]["title"])
        check("json uiBlock 마스킹", mp["messages"][1]["uiBlocks"][0]["reason"] == "문의 [이메일]")
        check("json 조문 보존", mp["messages"][1]["segments"][0]["text"] == "소득세법 제33조에 따라")
        check("json 리포트 합산", res["report"] == {"상호": 1, "전화": 1, "이메일": 1, "이름": 1}, res["report"])

        # ── 역할별 RLS ────────────────────────────────────────────────
        now = "(extract(epoch from now())*1000)::bigint"
        cur.execute(
            f"insert into public.conversations (id, occupation, title, owner_id, owner_label, created_at, updated_at, payload)"
            f" values ('dry-pool-1','clinic','미소치과 010-1111-2222 문의','viewer','사장님',{now},{now},%s::jsonb),"
            f"        ('dry-pool-2','clinic','owner2 대화','owner2','사장님2',{now},{now},%s::jsonb)",
            (json.dumps(payload), json.dumps(payload)),
        )

        def as_user(who):
            cur.execute("set local role authenticated")
            cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({"sub": UID[who], "role": "authenticated"}),))

        def reset():
            cur.execute("reset role")

        def expect_error(label, sql, args=()):
            cur.execute("savepoint sp")
            try:
                cur.execute(sql, args)
                cur.fetchall() if cur.description else None
                check(label, False, "오류가 나야 함")
            except psycopg.Error:
                check(label, True)
            cur.execute("rollback to savepoint sp")

        # 세무사: 동의 전 풀 비어 있음(드라이 행 기준)
        as_user("auditor")
        cur.execute("select conversation_id from public.list_pool_cases() where conversation_id like 'dry-%'")
        check("동의 전 풀에 없음", cur.fetchall() == [])
        expect_error("세무사는 동의 불가", "select public.grant_pool_consent('dry-pool-1')")
        reset()

        # 사장님: 남의 대화 미리보기·동의 불가, 본인은 가능
        as_user("viewer")
        expect_error("남의 대화 미리보기 불가", "select public.preview_pool_mask('dry-pool-2')")
        expect_error("남의 대화 동의 불가", "select public.grant_pool_consent('dry-pool-2')")
        cur.execute("select public.preview_pool_mask('dry-pool-1')")
        prev = cur.fetchone()[0]
        check("미리보기 리포트", prev["report"] == {"상호": 1, "전화": 1, "이메일": 1, "이름": 1}, prev["report"])
        cur.execute("select count(*) from public.conversation_pool_consents where conversation_id='dry-pool-1'")
        check("미리보기는 저장 안 함", cur.fetchone()[0] == 0)
        cur.execute("select title, expires_at - granted_at, revoked_at from public.grant_pool_consent('dry-pool-1')")
        title, span, rv = cur.fetchone()
        check("동의 7일", span == 7 * 24 * 3600 * 1000)
        check("동의 제목 마스킹", title == "[상호] [전화] 문의", title)
        expect_error("직접 insert 차단",
                     f"insert into public.conversation_pool_consents (conversation_id, viewer_id, granted_at, expires_at, masked_at) values ('dry-pool-2','viewer',1,2,1)")
        cur.execute("update public.conversation_pool_consents set expires_at = 1 where conversation_id='dry-pool-1'")
        check("직접 update 0행", cur.rowcount == 0)
        cur.execute("select conversation_id from public.conversation_pool_consents")
        cur.execute("select count(*) from public.conversation_pool_consents where viewer_id <> 'viewer'")
        check("사장님은 본인 동의만", cur.fetchone()[0] == 0)
        expect_error("사장님은 풀 목록 불가", "select * from public.list_pool_cases()")
        reset()

        as_user("owner2")
        cur.execute("select count(*) from public.conversation_pool_consents where conversation_id='dry-pool-1'")
        check("다른 사장님은 남의 동의 못 봄", cur.fetchone()[0] == 0)
        expect_error("다른 사장님은 철회 불가", "select public.revoke_pool_consent('dry-pool-1')")
        reset()

        # 세무사: 풀에 뜸 / 테이블 직접 조회 불가 / 상세 열람 기록
        as_user("auditor")
        cur.execute("select title, first_question, turn_count, viewed_by_me, mask_report from public.list_pool_cases() where conversation_id='dry-pool-1'")
        row = cur.fetchone()
        check("동의 후 풀에 뜸", row is not None)
        if row:
            check("목록 첫 질문 마스킹", row[1] == "[상호] 원장 [이름]입니다. [전화]", row[1])
            check("목록 턴 수", row[2] == 1)
            check("열람 전 viewed_by_me=false", row[3] is False)
        cur.execute("select count(*) from public.conversation_pool_consents")
        check("세무사 동의 테이블 직접 조회 0", cur.fetchone()[0] == 0)
        cur.execute("select count(*) from public.pool_case_views")
        check("세무사 열람기록 직접 조회 0", cur.fetchone()[0] == 0)
        cur.execute("select masked_payload from public.open_pool_case('dry-pool-1')")
        mp2 = cur.fetchone()[0]
        check("상세 = 마스킹 사본", "010-1234-5678" not in json.dumps(mp2["messages"], ensure_ascii=False) and mp2["id"] == payload["id"])
        cur.execute("select masked_payload from public.open_pool_case('dry-pool-1')")
        cur.execute("select viewed_by_me from public.list_pool_cases() where conversation_id='dry-pool-1'")
        check("열람 후 viewed_by_me=true", cur.fetchone()[0] is True)
        expect_error("동의 없는 대화 상세 불가", "select * from public.open_pool_case('dry-pool-2')")
        reset()

        as_user("admin")
        cur.execute("select auditor_id, view_count from public.pool_case_views where conversation_id='dry-pool-1'")
        check("admin 은 열람 기록 봄(2회)", cur.fetchall() == [("auditor", 2)])
        cur.execute("select count(*) from public.list_pool_cases() where conversation_id='dry-pool-1'")
        check("admin 도 풀 조회", cur.fetchone()[0] == 1)
        reset()

        # 만료 경과분 제외
        cur.execute("update public.conversation_pool_consents set expires_at = %s where conversation_id='dry-pool-1'", (1,))
        as_user("auditor2")
        cur.execute("select count(*) from public.list_pool_cases() where conversation_id='dry-pool-1'")
        check("만료분 제외", cur.fetchone()[0] == 0)
        expect_error("만료분 상세 불가", "select * from public.open_pool_case('dry-pool-1')")
        reset()

        # 재동의 → 다시 뜸 → 철회 → 즉시 사라짐 + 사본 비움
        as_user("viewer")
        cur.execute("select revoked_at from public.grant_pool_consent('dry-pool-1')")
        check("재동의", cur.fetchone()[0] is None)
        reset()
        as_user("auditor2")
        cur.execute("select count(*) from public.list_pool_cases() where conversation_id='dry-pool-1'")
        check("재동의 후 다시 뜸", cur.fetchone()[0] == 1)
        reset()
        as_user("viewer")
        cur.execute("select revoked_at is not null, masked_payload is null from public.revoke_pool_consent('dry-pool-1')")
        check("철회 + 사본 비움", cur.fetchone() == (True, True))
        reset()
        as_user("auditor2")
        cur.execute("select count(*) from public.list_pool_cases() where conversation_id='dry-pool-1'")
        check("철회 즉시 사라짐", cur.fetchone()[0] == 0)
        expect_error("철회분 상세 불가", "select * from public.open_pool_case('dry-pool-1')")
        reset()

        # admin 강제 철회
        as_user("viewer")
        cur.execute("select public.grant_pool_consent('dry-pool-1')")
        reset()
        as_user("admin")
        cur.execute("select revoked_at is not null from public.revoke_pool_consent('dry-pool-1')")
        check("admin 강제 철회", cur.fetchone()[0] is True)
        reset()

        # 내부 함수는 사용자 실행 불가
        as_user("viewer")
        expect_error("mask_conversation_payload 사용자 실행 불가", "select public.mask_conversation_payload('{}'::jsonb)")
        expect_error("_pool_mask_text 사용자 실행 불가", "select * from public._pool_mask_text('x')")
        reset()

        conn.rollback()
        print("[dryrun] 롤백")

    print(f"\n결과: {ok} OK / {fail} FAIL")
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
