# LLM1 v2 — 역할 축소 구현 설계

**작성 2026-09-25.** 여러 세션에 걸친 제품 공사의 설계 마스터. 진행 기록은 맨 아래 § 진행 기록에 쌓는다.
설계가 현실과 어긋나면 **본문을 고친다.**

근거(로컬 `docs/`, 이 PC 에만 있음 — 요지는 이 문서에 옮겨 적었다):
- 결론 기록 `history/260925_LLM1_W4개선회차_체크리스트RAG신호0_오라클천장68퍼센트_Claude블라인드54퍼센트_LLM1역할축소.md` (추적됨)
- 격리·원복 `docs/doing/v2격리_원복설계.md` · 로드맵 `docs/doing/LLM1강화_사실관계추출_로드맵.md` §6 · 기능 정본 `docs/doing/BEFORE_AFTER_기능명세.md`
- D3·D4 명세 `docs/doing/260923_LLM1데이터셋_검토/회신_정책확정_260924.md` · 하니스 `docs/doing/260924_LLM1충분성평가/`

---

## 1. 한 문장

**LLM1 은 1턴에서 "충분"을 판정하지 않는다. 추출하고, 되묻고, 2턴에 "물은 것이 답해졌나"만 대조한다. 멈추는 건 D4 로직이다.**

## 2. 왜 (9/25 측정, 재논의 금지)

평가 446건, 진짜 지표 = 중간 vs 충분(비교선 = 길이 규칙 오라클 72%):

| 방식 | 중간 vs 충분 | 비고 |
|---|---|---|
| 열린 판정 baseline / max3 / 판정만 | 50.0 / 49.2 / 50.0% | 충분 재현율 0.9~4.8% — "충분"이라고 말하지 않는다 |
| 검색 체크리스트(k=3, leave-case-out) | 50.8% | 이웃 항목 missing 비율이 충분·불충분 모두 45% = 신호 0 |
| 자기 케이스 목록(오라클, 천장) | 68.6% | 닫힌 대조조차 길이 규칙 밑 |
| Claude 블라인드(진단값) | 54.2% | **상위 모델도 못 함 → 과제 정의 문제**, 모델 교체로 안 풀림 |

라벨의 "충분" = 그 판례가 갈린 1~3개 사실이 다 나옴 — **질문만으로는 어떤 모델도 알 수 없다.**
반면 **"내가 물은 사실이 답해졌나"는 닫힌 대조**라 쓸 만하다(항목 정확도: 기재→stated 73%, 미기재→missing 91%).

## 3. 흐름 — 누가 무엇을 하나

| 턴 | 주체 | 동작 |
|---|---|---|
| 1 | **LLM1**(solar-pro3) | 추출: `known_facts` + `missing_facts`(**최대 3개**, 결정력 순) — 부록 A |
| 1 | 로직 | missing 있으면 **ask**(상위 2개, D4) · 비었으면 proceed. 판정 필드 값은 **쓰지 않는다** |
| 2 | **LLM1** | **닫힌 대조**: 1턴에 물은 사실(+1턴 추출의 나머지 누락)만 체크리스트로 → 항목별 `stated`/`unknown`/`missing` — 부록 B |
| 2 | 로직 | stated → `filled` · "모르겠어요" → D3(대체 질문 1회, 사실당) · 남으면 ask · 다 차면 proceed |
| 상한 | 로직(D4) | 되묻기 2턴이 끝나면 무조건 진행 — 빈 사실은 `proceed_with_gap`(조건부 답변) |

- **D4 는 LLM 없는 로직**(턴·개수 카운터)이다. 충분을 판정하지 않고 **종료를 보장**한다.
- ⚠️ **2턴에 열린 재추출 금지.** 새 누락을 또 늘어놓아(baseline 중앙값 4~5개) 매 턴 되묻기가 된다. 대조 범위는 닫는다.
- LLM1 되묻기 턴은 `handoff.is_stalled` 집계 **제외** — v2 호출부에서 처리, `handoff.py` 무변경(공유 파일).
- 대가: **정보를 다 준 사용자도 1턴은 질문을 받는다** — 경험 저하, 고장 아님. 완화책 = 되묻기 카드의 **"이대로 답변 받기"**(O-1 확정) → 즉시 `proceed_with_gap`.

## 4. 코드 자리 (격리 규칙은 `v2격리_원복설계.md` §1~§2 그대로)

| 새 파일(v2 전용) | 내용 |
|---|---|
| `backend/api/pipeline_agentic.py` | §3 흐름 + D4 카운터. `pipeline.py` 무변경 |
| `backend/api/llm1.py` | `extract_facts()`(부록 A) · `check_asked()`(부록 B). `llm.py` 의 `bounded_client`·`_history_to_messages` 재사용 |
| `backend/api/prompts/v2/…` | 프롬프트 원문 |

**공유(클론 금지)**: `schema.py`(선택 필드 추가만) · `upstage_gate.py` · `numeric_guard.py` · `handoff.py` · `auth.py` · `rag/*`.
**스위치(✅ 단계 1)**: `?pipeline=v1|v2` > env `CHAT_PIPELINE` > v1, 모르는 값은 v1 — `rag`/`ragSource` 와 같은 모양.
`main.py` 에서는 인자명이 모듈 `pipeline` 과 겹쳐 `pipeline_name: Query(alias="pipeline")`. v2 응답은 `meta.pipeline="v2"`(v1 엔 필드 없음).
**브랜치**: `agentic-v2`(import-credigraph 에서 분기, origin 에 있음) — 서버 deploy.sh 는 import-credigraph 만 만지므로 구조적으로 배포 안 됨.

### 4-1. 서버 위상 (✅ 단계 0.5, 2026-09-25)

```
Caddy ─┬─ /api/chat?pipeline=v2 ─→ 8788 v2 유닛(꺼짐) ─연결거부→ 8787 v1   (lb_policy first)
       └─ 그 밖 전부 ───────────────────────────────→ 8787 v1
```
| | v1 `neo-luddite-api` | v2 `neo-luddite-api-v2` |
|---|---|---|
| 코드 | `/opt/neo-luddite` (import-credigraph) | `/opt/neo-luddite-v2` = **git worktree**(agentic-v2). **손으로 pull** |
| venv | 자기 것 | **자기 것**(lock 설치, 설치 시점 freeze 동일) |
| `.env` | 원본 | v1 `.env` **심볼릭 링크** |
| 스케줄러 | 켬 | **`BACKGROUND_JOBS=off`**(유닛 Environment) — 켜면 리퍼가 v1 의 job 을 죽인다 |
| Upstage 게이트 | k=3 | **k=1** — 게이트는 프로세스 안의 줄이라 **"같은 줄 공유"는 두 프로세스로는 불가**, 합계 상한 4 로 타협 |

- 원복: **v2 유닛 `disable --now` 가 곧 킬 스위치**(Caddy 가 v1 로 흘린다). env `CHAT_PIPELINE` 은 v2 프로세스 안의 디폴트일 뿐이고
  `?pipeline=v2` 가 이기므로, 두 프로세스 위상에서 원복 1단계(env)는 의미가 약하다 — 2단계가 실질 1단계.
- 프리뷰 프론트가 `?pipeline=v2` 를 붙이는 배선은 아직 없다(단계 3, 브랜치 프론트).

**호출 규약(하니스 실측)**: `tool_choice` **강제 지정**(auto = 120초 멈춤 1회) · `max_tokens` 상한(하니스 600) ·
temperature 0 · 순차(동시 3 → p50 62초) → 반드시 `upstage_gate` 경유.

**v1 참고 — `llm.verify_decisive()`(llm.py:434)**: 같은 종류(항목별 "사용자가 말했나")의 일을 v1 이 이미 한다. 날조 방어로는 맞지만
프롬프트가 "확신 없으면 넣지 마라"라서 **9/25 에 측정한 오류 방향(부정형 답 → 미기재)과 같은 쪽으로 기운다.** v2 는 부록 B 의
"부정형 답도 stated" 규칙을 쓴다. v1 은 건드리지 않는다.

## 5. 단계

| 단계 | 내용 | 완료 조건 |
|---|---|---|
| **0.5 ✅** | v2 자리 — systemd 유닛 2개 구성 가능(v2 유닛은 **켜지 않음**) + Caddy 라우팅 자리 (§4-1) | v1 동작 영향 0 (헬스·채팅 1회) |
| **1 ✅** | 브랜치 `agentic-v2` + 스캐폴딩(`pipeline_agentic.py` 골격이 v1 으로 위임), `CHAT_PIPELINE` 배선 | 디폴트 v1 유지, `?pipeline=v2` 가 골격을 탄다 (백엔드 테스트 스위트는 없다 → 로컬 스모크로 대신) |
| **2 (W3)** | `llm1.extract_facts()` — `engine_adapter` 지출유형 enum 없이 도메인 일반 추출. 날조 방어 유지 | 되묻기 갈래가 엔진 enum 을 참조하지 않음 · 병의원 회귀 케이스 유지 |
| **3 (W4 축소판)** | §3 흐름 + D4 카운터 + `check_asked()` + D3 대체 질문 + `is_stalled` 제외 + **"이대로 답변 받기"(O-1)** | 3턴 시나리오(부분답변·모르겠어요·상한) 로컬 통과 |
| **4 (데이터 세션)** | W2 궤적 63건으로 **턴 단위 평가** — 2턴 `check_asked()` 의 filled/unknown 정확도 | 부록 B 개작본의 항목 정확도가 오라클 v2(73%/91%) 근처 |
| **5** | v2 유닛 기동 + 플래그로 소수 트래픽 | 원복 4단계 중 1단계(env) 리허설 |

## 6. 열린 결정 (사용자 몫 — 세션이 정하지 말 것)

- **O-1 ✅ 확정(2026-09-25)**: 되묻기 카드에 **"이대로 답변 받기"** 버튼을 둔다 → 누르면 `proceed_with_gap`. 정본에 **A1-1** 로 추가했다.
  구현 자리: 단계 3(W4 축소판) — 요청에 "건너뛰기" 신호(선택 필드) + D4 로직이 그 신호로 즉시 조건부 진행. 프론트 되묻기 카드에 버튼(브랜치에서).
- **O-2 ✅ 확정(2026-09-25, 사용자)**: 턴 간 상태 = **assistant `Message` 의 선택 필드 `askState`** — 서버 무상태, 직전 assistant 의
  `askState` 를 history 에서 읽는다. "이대로 답변 받기" 신호 = **`ChatRequest` 선택 필드 `action: "proceed_with_gap"`** +
  `userInput.text` 는 버튼 문구(대화 기록에 사용자의 선택이 남는다). 직전 assistant 에 `askState` 가 있을 때만 존중.
  기각: ②`agentic.*` 테이블(0041 이 프로덕션 DB 로 감·매 턴 DB 쓰기·인증 없는 conversationId·화면과 상태 어긋남)
  ③history 본문 재구성(D3 "대체질문 썼나"·unknown 복원이 취약) / 신호를 user Message 필드·문구 매칭으로 두는 안.
  초안 모양(단계 3 에서 확정):
  ```
  AskedFact { fact: str, why?: str, status: "asked"|"filled"|"unknown", rephrased: bool }   # rephrased = D3 1회 썼나
  AskState  { askTurn: int, facts: AskedFact[] }                                              # askTurn = D4 카운터
  Message.askState?: AskState      ChatRequest.action?: "proceed_with_gap"
  ```
  ⚠️ **함정 — 프론트가 모르는 필드를 조용히 지운다.** `services/chat.ts` 가 응답을 Zod `messageSchema`(비-strict `z.object`)로
  파싱하면 모르는 키는 제거되고 에러도 없다 → 2턴 history 에 `askState` 가 **없는 채로** 온다. 백엔드 `schema.py` 와
  **같은 커밋에서** `frontend/lib/conversation-schema.ts` `messageSchema` 에 선택 필드를 넣는다(브랜치 프론트만).
  `meta` 는 passthrough 지만 스토어엔 `message` 만 들어가므로 상태를 못 나른다. 영속화(`persistLive`)는 스토어 원본을
  `conversations.payload` 에 저장하므로 필드가 남고, 세션 재개 시 복원된다. v1 pydantic 은 모르는 필드를 무시 → Caddy 폴백 무해.

## 7. 측정 밖인 변경 (구현 때 알고 할 것)

하니스로 잰 원문(부록)과 제품본이 달라지는 자리. 달라지면 **단계 4 에서 다시 잰다.**
1. 부록 A 는 `sufficiency` 필드를 가진 채로 쟀다 — 제품에서 필드를 빼면 추출 분포가 바뀔 수 있다. **처음엔 원문 그대로 두고 값만 무시**하는 것이 안전.
2. 부록 B 는 "비슷한 과거 상담의 사실" 문구 + 단일 질문으로 쟀다 — 제품은 "1턴에 물은 사실" + 대화 전체. 문구 개작 필요.
3. `unknown`(모르겠어요) 상태는 새 enum 값 — 측정 안 됨. D3 때문에 필수.

---

## 부록 A — 1턴 추출 (하니스 `SYSTEM_MAX3`/`TOOL_MAX3`, 9/25 측정: 퇴화 잘림 37→0, 나열 중앙값 3, p50 1.0초)

```
당신은 세무 상담 챗봇의 1단계(LLM1)입니다. 사용자의 상담 질문을 읽고, 세무 판단(과세 여부·가능 여부 등)을 내리는 데 **결론을 가르는 사실**이 질문 안에 모두 나와 있는지 판정합니다.
규칙:
1. 답을 쓰지 마세요. 판정만 합니다.
2. sufficient = 판단에 결정적인 사실이 전부 질문에 명시돼 있어, 추가로 물을 것 없이 바로 답변 단계로 넘길 수 있음.
3. insufficient = 결론이 달라질 수 있는 사실이 하나라도 빠져 있음. 빠진 사실 중 **결론을 가르는 것만, 최대 3개**를 missing_facts 에 결정력 순으로 적으세요. 결론을 바꾸지 않는 확인 사항은 적지 마세요.
4. 질문이 길다고 충분한 것이 아닙니다. 사용자가 **말하지 않은 사실을 짐작해 채우지 마세요**.
5. 사소한 배경 정보가 아니라 결론을 가르는 사실만 따집니다.
judge_sufficiency 도구로만 응답하세요.
```
도구 `judge_sufficiency{sufficiency: enum[sufficient,insufficient], missing_facts: string[] (maxItems 3, "insufficient 일 때 빠진 결정적 사실(결정력 순). sufficient 면 빈 배열.")}`, required 둘 다.
주의: solar-pro3 는 인자에서 `missing_facts` 를 `sufficiency` **앞에** 쓴다 — 잘리면 판정값이 없다(제품은 판정값을 안 쓰므로 무해).

## 부록 B — 2턴 대조 (하니스 `CHECK_SYSTEM_V2`/`CHECK_TOOL`, 오라클 v2 측정: 기재→stated 73.2%, 미기재→missing 91.4%, p50 0.75초)

```
당신은 세무 상담 챗봇의 1단계(LLM1)입니다. 아래 체크리스트는 이 질문과 비슷한 과거 상담에서 **결론을 가른 사실**들입니다.
각 항목에 대해 status 를 하나 고르세요:
- not_relevant: 이 질문의 세무 판단과 관계없는 사실(다른 상황의 쟁점).
- stated: 이 질문의 판단에 필요하고, 사용자가 질문 안에서 **이미 밝혔다**(구체적 값·사정이 나와 있음).
- missing: 이 질문의 판단에 필요한데, 질문에 **나와 있지 않다**.
주의: 사용자가 그 사실에 대해 **어떤 답이든 했으면 stated** 입니다 — "없어요", "안 했어요", "한 번도 없어요",
"서류는 따로 없어요" 같은 **부정형 답도 stated** 입니다(사실이 '없음'으로 확인된 것). 날짜·금액이 대략적이어도
("작년 3월 초", "다음 주") 판단에 쓸 수 있으면 stated. missing 은 사용자가 그 사실을 **아예 언급하지 않았을 때만**.
규칙: 사용자가 말하지 않은 사실을 짐작해 채우지 마세요. 질문 길이와 무관하게 항목별로 대조하세요. 답변은 쓰지 않습니다.
check_facts 도구로만 응답하세요.
```
사용자 메시지 형식: `[상담 질문]\n{질문}\n\n[체크리스트]\n1. {fact} — {why_it_matters}\n2. …`
도구 `check_facts{items: [{no: integer, status: enum[not_relevant,stated,missing]}]}`. 응답에 빠진 번호는 `unjudged` 로 따로 센다(missing 취급 안 함).
**v1(부정형 규칙 없음)은 기재→stated 50.7%** — 이 한 줄이 가장 큰 개선이었다. 지우지 말 것.

---

## 진행 기록

- **2026-09-25** — 설계 작성(데이터 세션 결론에서). 단계 0.5 부터 시작. 코드 0줄.
- **2026-09-25** — O-1 확정: "이대로 답변 받기" 버튼 → 정본 A1-1. O-2 는 다음 세션에서 사용자가 결정.
- **2026-09-25** — **사용자가 LLM1 역할 축소를 채택, 정본 개정**(`BEFORE_AFTER_기능명세.md`): A1 본문 교체(옛 문구는 머리 개정 이력에) · A1-1 신설 · §3 재사용표 · §6 D3·D4 닫힘 이동 · §7 S1 · §8 새 baseline(2턴 대조 정확도 + 운영 지표: 되묻기 턴 수·proceed_with_gap 비율·버튼 사용률). 로드맵 §6 W4 완료 조건도 교체.
- **2026-09-25** — **단계 0.5·1 완료, O-2 확정.** 브랜치 `agentic-v2`(`dd9a133`, origin push — import-credigraph·main 무변경).
  코드: `pipeline_agentic.py` 골격(v1 위임 + `meta.pipeline`) · `?pipeline=` 스위치 · `BACKGROUND_JOBS=off` lifespan 가드 · `ChatMeta.pipeline`.
  서버: worktree `/opt/neo-luddite-v2` · 전용 venv(lock) · `.env` 링크 · v2 유닛 설치(**disabled/inactive**) · Caddy v2 경로 + v1 폴백
  (백업 `/etc/caddy/Caddyfile.bak-260925-pre-v2`). 검증: 헬스·CORS 200, 실제 채팅 200(v1 되묻기), `?pipeline=v2` → v1 폴백 0.3초.
  설계와 달라진 것: **게이트 "같은 줄 공유"는 두 프로세스로 불가 → v2 k=1**, 원복 1단계(env)는 두 프로세스 위상에서 약함(§4-1).
  기록 `history/260925_LLM1v2_단계0.5와1_…md`.
