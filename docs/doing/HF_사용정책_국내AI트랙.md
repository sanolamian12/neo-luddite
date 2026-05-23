# HuggingFace Transformers 사용 정책 — 국내 AI 트랙 컴플라이언스

> 팀: 네오러다이트 (Neo-Luddite) · 프로젝트: CrediGraph
> 작성: 2026-05-16 · 5/21 기술 워크숍 전 팀 공유용 한 페이지 정책

---

## 0. 한 줄 원칙

> **트랙 위반 판정은 "어떤 라이브러리를 import 했는가"가 아니라 "어떤 모델 가중치를 추론에 썼는가"로 결정된다.**

HuggingFace `transformers`, PyTorch, `datasets`, `evaluate`, `accelerate`, `peft`, `trl` 등은 **SDK/도구**이며 그 자체로는 트랙에 영향이 없다. 위반은 다음 한 줄로 환원된다:

```
이 추론 호출이 5개 연계기업(KT · LG AI연구원 · NC AI · SKT · 업스테이지) 모델인가?
```

학습·합성 데이터 생성·검색·평가·judge 어느 단계든 동일 기준.

---

## 1. 허용 / 금지 / 회색지대

### ✅ 허용 (자유롭게 사용)

| 카테고리 | 예시 |
|---|---|
| 국내 연계기업 API | Upstage Solar Pro 3, Document Parse, Information Extract, Solar Embedding; SKT A.X K1 (OpenAI 호환 API) |
| 국내 모델 HF 로드 | `AutoModel.from_pretrained("K-intelligence/Midm-2.0-Base-Instruct")`, LG EXAONE, NC AI VARCO |
| 국내 모델 토크나이저 | 위 모델들의 `AutoTokenizer` |
| 데이터 도구 | `datasets`, `pandas`, `numpy`, `pyarrow` |
| 평가 메트릭 | `evaluate`(BLEU/ROUGE/F1), `seqeval`, scikit-learn — 룰베이스 계산 |
| 학습 인프라 | `trl`, `peft`(LoRA), `accelerate` — 단, 학습 대상은 국내 모델 가중치에 한정 |

### ❌ 금지 (즉시 트랙 위반)

| 카테고리 | 예시 |
|---|---|
| 외산 LLM API | OpenAI(GPT), Anthropic(Claude), Google(Gemini), xAI(Grok) |
| 외산 오픈모델 추론 | Llama, Mistral, Qwen, Gemma, Phi, DeepSeek — HF에서 load해 inference |
| 외산 임베딩 | OpenAI `text-embedding-*`, BGE, E5, sentence-transformers의 외산 베이스 |
| 외산 리랭커 | `bge-reranker-*`, Cohere rerank |
| **LLM-as-judge** | 평가 단계에서 GPT-4 / Claude로 합의 정답 채점 ← **가장 빠지기 쉬운 함정** |
| 합성 데이터 생성 | 외산 LLM으로 학습/검수용 합성 케이스 생성 |

### ⚠️ 회색지대 — 결정해서 빼버린다

1. **임베딩**: sentence-transformers 기본값(`all-MiniLM`, `multilingual-e5` 등)을 무심코 쓰면 위반. → **Upstage Solar Embedding API로 통일**.
2. **리랭커**: 마찬가지로 자체 구현 또는 Solar/Mi:dm 기반으로.
3. **LLM-as-judge**: 학계 표준이 GPT-4 judge지만 트랙상 사용 불가. → **Solar Pro 3 self-judge + 관리자 검토 + 정량 메트릭** (제안서 §2.2의 3단계 구조와 일치).
4. **`tiktoken`**: 토크나이즈 자체는 추론이 아니므로 OK. 단 OpenAI API 호출 보조용 외엔 안 쓰는 게 깔끔.

---

## 2. 제안서·문서에 박을 표현

본선 보충 자료 / 코드 README / 발표 슬라이드에 **그대로 복사해 사용**:

> "HuggingFace Transformers / PyTorch는 도구 라이브러리로만 사용하며, 모델 추론은 Upstage Solar Pro 3 / Document Parse / Information Extract API (필요 시 KT Mi:dm 2.0, SKT A.X K1 등 연계기업 모델)에 한정한다. 외산 LLM·임베딩·리랭커·judge 모델은 학습·합성 데이터 생성·평가 단계를 포함해 일체 사용하지 않는다."

---

## 3. 코드 가드레일 (구현 시작 시점에 둘 것)

- `requirements.txt` / lockfile에 외산 모델 가중치 미포함. SDK 패키지(`transformers`, `torch`, `openai`, `datasets`, `evaluate`, `peft`, `trl`, `accelerate`)만 핀.
- **CI 정적 검사**: 금지 model-id 부분 문자열 grep 후 매치 시 build fail. 차단 목록 예:
  - `gpt-`, `claude-`, `meta-llama/`, `mistralai/`, `Qwen/`, `google/gemma`, `deepseek-`, `microsoft/phi-`
  - `bge-`, `intfloat/e5-`, 외산 베이스 `sentence-transformers/`
- 모든 `openai.OpenAI(...)` 인스턴스화는 `base_url` 명시 강제 (Upstage `https://api.upstage.ai/v1` 또는 SKT `https://api.ax-k1.sktai.qa/v1`). default endpoint는 차단 — wrapper나 lint 규칙으로 `base_url` 없는 호출 거부.
- 임베딩·리랭커·judge default를 국산 모델로. `sentence-transformers` default import 금지.
- 합성 데이터 스크립트도 허용 endpoint만 호출. 외산 LLM이 들어간 프로토타입 노트북은 `# TRACK-VIOLATION: prototype only, never run in pipeline` 명시 + CI 제외.

---

## 4. 미해결 사항 (5/21 기술 워크숍에서 운영진 확인 필요)

본 정책은 팀 해석. 트랙 판정 권한은 NIPA/TTA. 워크숍에서 다음 항목 공식 확인 후 본 문서 업데이트:

1. HF Transformers 라이브러리로 **국내 모델만 load**해 추론하면 100% 조건 충족 인정인가
2. **합성 학습 데이터 생성**에 외산 LLM 사용 시 트랙 영향
3. **평가 단계 LLM-as-judge**에 외산 모델 사용 가능 여부
4. 연계기업 외 **국산 공개·학계 모델**(KOALPACA, KULLM 등) 사용 시 트랙 인정 여부
5. **OCR/임베딩/리랭커** 보조 모델도 100% 조건 포함인지, LLM에만 적용인지
6. **연계기업 모델 간 혼용**(예: Upstage + KT Mi:dm + SKT A.X K1)도 100% 조건 충족인가

---

*출처: [사업설명회 §4 트랙 정의](AI_챔피언_대회_사업설명회.md), [구현 제안서 §3.3 기술스택](서식0__구현제안서_챔피언_네오러다이트.md)*
