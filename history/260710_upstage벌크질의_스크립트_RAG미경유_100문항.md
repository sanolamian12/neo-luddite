# Upstage 벌크 질의 스크립트 — RAG 미경유 100문항 Q&A

날짜: 2026-07-10 · 브랜치: `import-credigraph` · 목적: 만들어진 credigraph 프로그램(하차장→검사실→RAG 파이프라인)을 **타지 않고**, 준비된 세무 질문 100문장을 Upstage `solar-pro3`에 **직접 벌크 호출**해 각 답변을 CSV/TXT로 저장.

## 요구 (사용자)

- 병의원 비용처리 세무 질문 100문장(txt, 한 줄=한 질문)을 API로 벌크 질의.
- 결과를 텍스트/CSV로 저장.
- **RAG를 쓰지 말 것** — 벡터검색·임베딩·검수보드 지식 주입 없이 모델의 파라메트릭 지식만으로 답하게.

## 산출물

- **스크립트**: [backend/bulk_ask.py](../backend/bulk_ask.py) (신규)
- **입력**: `~/Desktop/upstage bulk 질문 리스트.txt` (UTF-8, 100문장)
- **출력**: `~/Desktop/upstage bulk 답변.csv` (UTF-8-BOM, Excel 호환) + 동명 `.txt`(사람이 읽기 좋은 포맷)

## 스크립트 설계 (bulk_ask.py)

기존 [backend/api/llm.py](../backend/api/llm.py)와 동일하게 **openai SDK + `base_url` 오버라이드**로 Upstage 호출(OpenAI 호환). 단, llm.py의 function-calling/세그먼트 로직은 안 쓰고 **순수 chat**만.

- **RAG 미경유(핵심)**: `chat.completions` 에 `[system, user]` 두 메시지만. 임베딩(`embedding-query/passage`) 호출 없음, `rag_passages` 주입 없음, Supabase/백엔드 미경유. → 모델 지식만으로 답변.
- **system 페르소나**: "병의원 전문 세무사"(질문이 전부 병의원 비용처리라서). 파일 상단 `SYSTEM_PROMPT` 만 고치면 톤/역할 변경 가능.
- **이어하기(resume)**: 출력 CSV에서 이미 답한(비-ERROR) 질문은 건너뜀 → 중간에 끊겨도/오류건만 재실행.
- **재시도**: 레이트리밋·일시오류 시 지수 백오프(1·2·4·8s), 최종 실패는 `[ERROR]` 로 기록(다음 실행때 자동 재시도).
- **동시호출**: `ThreadPoolExecutor`(기본 `--workers 4`), 순서는 최종 CSV 재작성 때 질문 순서대로 정렬 보존.
- **인코딩**: 입력 UTF-8 읽기, 출력 CSV **UTF-8-BOM**(Excel 한글 안깨짐), 콘솔 stdout도 UTF-8 reconfigure(Windows 코드페이지 로그 깨짐 방지 — 파일 저장과 무관).
- **환경**: `backend/.env` 를 python-dotenv 없이 최소 파서로 로드 → `UPSTAGE_API_KEY` / `UPSTAGE_BASE_URL`(`api.upstage.ai/v1`) / `UPSTAGE_CHAT_MODEL`(`solar-pro3`).

## 실행 방법

```powershell
cd c:\Users\user\Neo-Luddite\backend
.\.venv\Scripts\python.exe bulk_ask.py
# 경로/속도 변경: bulk_ask.py --in "질문.txt" --out "답변.csv" --workers 4
```
- 실행 파이썬은 backend 전용 venv([backend/.venv](../backend/.venv), openai 2.44.0). 시스템 python에는 openai 미설치.

## 검증

- **스모크 2문항**(→ 임시경로) 실제 API 호출 성공: 한글 답변·UTF-8-BOM CSV 정상, 2문항 21s, 오류 0.
- **최종 출력 상태**: `~/Desktop/upstage bulk 답변.csv` = **100행 전부 답변 완료, 오류 0 / 빈칸 0**. no.1~100 정상.
  - 참고: 이 세션에서 마지막에 건 전체 실행은 `이번실행 0`으로 리턴 — 해당 출력 경로에 이미 100개 답변이 존재해 resume이 전부 스킵함(내가 이 세션에서 100콜을 새로 돌린 게 아니라, 파일이 이미 완성돼 있었음). 재실행해도 완성본 유지.

## 파일 인코딩 메모

- 입력 txt는 UTF-8/CRLF. (Windows 콘솔에서 `cat` 시 깨져 보이는 건 콘솔 코드페이지 문제일 뿐, 파일은 정상.)
- 대회 국내트랙 준수와 무관한 순수 Upstage 단독 호출(외산 모델·임베딩 미사용).
