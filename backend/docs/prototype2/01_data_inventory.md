# Prototype 2 — 데이터 인벤토리 (Database)

**목표(프로토타입 2):** **사람 평가자**가 챗 대화를 **라인(문장/세그먼트) 단위로 검토**하고
**피드백/코멘트**를 다는 인터페이스.

> ⚠️ 평가는 **사람이 수행**한다. 시스템은 자동 판정을 내리지 않는다.
> Tier 2(코퍼스/분석)는 평가자가 **옆에서 참고하는 근거 패널**일 뿐, 자동 채점기가 아니다.

이 문서는 그 인터페이스가 사용할 수 있는 데이터 자산을 3개 티어로 정리한다.

```
[Tier 1] 검토 대상      = 챗 대화 (세그먼트 단위)        ← 피드백이 붙는 단위
[Tier 2] 참고 패널      = 세무 케이스 코퍼스 + 분석      ← 평가자가 근거를 직접 확인
[Tier 3] 피드백 저장소  = 사람이 단 라인 피드백 (신규)   ← 이 프로토타입이 생성
```

---

## Tier 1 — 감사 대상: 챗 대화 (Primary subject)

라인 단위 피드백이 **붙는 대상**. 한 세그먼트 = 한 라인.

| 항목 | 값 |
|---|---|
| 위치 | `prototype/data/conversations/*.json` (3건) |
| 스키마 | `prototype/lib/conversation-schema.ts` (Zod) |
| 로더 | `prototype/lib/load-conversation.ts` (`getConversation`, `getConversations`) |
| 규모 | **대화 3건 / 세그먼트 36개** (vehicle 17, golf 10, gym 9) |
| DOM 노출 | `data-segment-id`, `data-segment-type`, `data-message-id` (`segment-renderer.tsx`) |

**Segment 필드** (피드백 앵커 단위):
| 필드 | 설명 |
|---|---|
| `id` | 안정·불변·고유 (예: `msg_002_s1`) — **피드백 외래키** |
| `text` | 문장 텍스트 |
| `type` | 10종: context·question·ack·issue_framing·rule_statement·application·evidence_request·conclusion·caveat·follow_up |
| `framework?` | 8종: 엄격해석·목적론해석·체계적해석·실질과세원칙·신의성실원칙·입증책임·유추해석·문언해석 |
| `citations?` | 케이스/법령 (예: `"조심2025구1960"`, `"소득세법 §78의3"`) |

대화 메타(`topic.caseRefs`, `topic.frameworks`, `persona`)도 감사 컨텍스트로 활용 가능.

---

## Tier 2 — 근거/레퍼런스 코퍼스 (Grounding)

피드백을 **검증·보강**하는 데 쓰는 읽기 전용 데이터. 모두 stdlib JSONL/JSON.

### 2-1. 케이스 코퍼스
| 파일 | 규모 | 내용 |
|---|---|---|
| `data/processed/all_cases.jsonl` | **1,301건** | 통합 케이스 (심판·해석·판례) |
| `data/processed/all_cases.csv` | 1,301 | 동일 데이터 CSV |
| `data/raw/tribunal_*.jsonl` / `expc_*.jsonl` / `prec_*.jsonl` | 출처별 원본 |

**TaxCase 필드**: `case_id, source, source_url, case_number, title, tax_category, law_articles, decision_date, decision_type, agency, summary, full_text, inquiry_agency, tags, collected_at`

### 2-2. 분석 산출물 (`data/analysis/`)
| 파일 | 내용 | 감사 활용 |
|---|---|---|
| `cases_structured.jsonl` | 케이스별 구조 분해 (`sections`/`subsections`/`section_lengths`) | 인용 케이스의 원문 구간 확인 |
| `reasoning_patterns.jsonl` | 케이스별 `canons`·`flow_markers`·`authority_citations`·`reasoning_phrases`·`issue_statements` | 라인의 프레임워크 태그 적정성 대조 |
| `canon_examples.json` | 해석론 6종별 실제 인용문 (`case_number, decision_type, tax_category, trigger, excerpt`) | "이 프레임워크의 모범 적용례" 제시 |
| `landscape_report` · `deep_landscape_report` (.json/.txt) | 쟁점 택소노미 | 주제 적합성 |
| `structure_report` (.json/.txt) | 결정문 구조 통계 | — |
| `reasoning_report` · `reasoning_deep_report` (.json/.txt) | 해석론 빈도·선택트리·입증책임 | 라인 추론의 타당성 기준 |

### 평가자 참고 활용 예 (실측)
- 챗 3건이 인용한 케이스 **`조심2025구1960`·`조심2025부4364`·`조심2025부4055`는 모두 코퍼스에 존재**
  → 평가자가 라인의 인용을 클릭하면 **근거 패널에서 해당 케이스 원문·요지를 바로 확인**할 수 있다.
- 세그먼트 `framework` 태그에 대해 `canon_examples.json`의 **모범 적용례를 나란히 보여주어** 평가자의 판단을 돕는다.
- (자동 합/불 판정이 아니라, 사람이 보고 판단하도록 **컨텍스트를 제공**하는 용도.)

---

## Tier 3 — 사람이 단 라인 피드백 저장소 (NEW — 이 프로토타입이 생성)

대화 데이터는 **불변(읽기 전용)**. 피드백은 **사람 평가자가 작성**하며 `segmentId`를 외래키로 갖는
**별도 컬렉션**으로 둔다. (기존 제안: `docs/prototype/conversation-format.md` 참조)

**확정 스키마** (상세·플로우: [02_requirements_flow.md](02_requirements_flow.md)):
```ts
type FeedbackTag = "legal_error" | "grammar_error" | "suggestion";

interface LineFeedback {          // 1~3단계: 문장 단위
  id; conversationId; segmentId;  // ← Segment.id 앵커
  reviewer; body;                 // 피드백 내용(필수)
  tags: FeedbackTag[];            // 선택
  createdAt;
}

interface SessionEvaluation {     // 4단계: 세션 전체
  id; conversationId; reviewer;
  qualitative: string;            // 4.1 정성(줄글)
  scores: { writing; legalAccuracy }; // 4.2 정량(문장력/법률정확)
  createdAt;
}
```

> 자동 룰/점수 부착은 범위 **아님**. 모든 평가는 사람이 Tier 2를 참고해 직접 판단·기록한다.

---

## 갭 / 주의사항
- **정답 라벨 없음**: 라인별 "정답" 피드백 데이터셋은 없음 → 사람이 작성하거나 룰 기반 신호로 보조.
- **판례 full_text 부재**: `law_prec`(741건)는 제목·요지만 있고 본문 없음 (law.go.kr SSL 제약) → 판례 인용 검증은 제목/요지 범위.
- **대화 규모 작음**: 현재 3건/36세그먼트(병의원). 감사 UX 검증엔 충분하나 데이터 다양성은 추후 확장 필요.
- **법령 인용 검증 미비**: 케이스(`조심…`)는 코퍼스로 검증 가능하나, 법령 조문(`소득세법 §…`)은 별도 법령 DB 없음 → 현재는 형식 검증만.

---

## 한 줄 요약 (사람 평가자 기준)
- **사람이 무엇을 검토하나** → Tier 1: `prototype/data/conversations/*.json`의 36개 세그먼트(라인).
- **사람이 무엇을 참고하나** → Tier 2: 1,301건 케이스 코퍼스 + 분석 산출물(근거 패널).
- **사람이 무엇을 남기나** → Tier 3: `segmentId` 외래키의 라인 피드백(코멘트·분류·수정 제안).
