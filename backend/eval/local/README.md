# 로컬 진단 도구 (10/16 — 스크래치에서 옮김, 운영 경로 아님)

`backend/` 에서 실행. 모두 운영 플래그(`prod_flags.env` — 비밀값 없음, 키는 `backend/.env`)를 env 로 깔고 프로세스 안 `pipeline.run_clinic` 을 부른다. `VEC_MEMORY=off`.
로컬도 법령은 운영 DB 에서 읽는다(`LAW_STORE` 기본 db). 로컬 uvicorn 은 띄우지 않는다(세션 풀 위험).

| 파일 | 쓰임 |
|---|---|
| `run_multi.py <태그> S02 X05 …` | 데모 세트 시나리오를 대화째(history 포함) 로컬 실행. 결과 `multi_<태그>.jsonl`(이 폴더) |
| `run_set.py <질문.jsonl> <태그>` | 단발 질문 묶음(`{"id","q"}` 줄) 로컬 실행 — 단계 로그(INFO) 출력 |
| `compound_set.jsonl` | 복합 사안 C1~C4·T03(E단계) |
| `fn_stats.py <journal.txt> 이름=UTC시작~UTC끝 …` | 서버 journald `[upstage_call]` → 창별 fn 중앙값 ms·출력/입력 토큰(같은 시간대 비교) |
| `d_format.py` · `make_doc.js` · `make_xlsx.py` | 세무사 평가 원문 md → Word(안내+원문) · Excel(점수 양식). `make_doc.js` 는 npm `docx` 필요(스크래치에 설치해 실행) |

journald 받기: `ssh -i ../docs/ssh-key-2026-09-24.key ubuntu@158.179.177.51 "journalctl -u neo-luddite-api --since '<UTC>' --until '<UTC>' -o short-iso --no-pager" > j.txt`
