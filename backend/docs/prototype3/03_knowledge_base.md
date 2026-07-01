# Prototype 3 — 지식 베이스 (Knowledge Base)

평가자(세무 전문가)가 작성·관리하는 **구조화된 지식 베이스**.
형식은 **Claude Skill**을 본떠 마스터 문서(`스킬.md`) + 보조 문서들이 폴더 트리로 정리된다.

## 왜 KB인가?
- 라인 피드백은 **개별 문장에 대한 사후 코멘트**이지만, 근본 원인은 대개 **공통 지식**의 부재다.
- 감사자가 "이 유형은 늘 이렇게 봐야 한다"를 한 번 적어두면 다른 평가에서 인용 가능하고, 향후 챗 응답 파이프라인의 그라운딩 소스로도 재사용할 수 있다(역방향 사용은 본 프토 범위 밖).
- 레포에 이미 풍부한 시드가 있다 — `docs/0X_*.md`, `data/analysis/*` — 이를 폴더별 **시드 문서**로 노출.

## v1 에디터 스코프
- **Textarea + 라이브 마크다운 프리뷰** (좌·우 분할).
- 프론트매터(title/summary/tags)는 본문 위 작은 폼.
- 위키 링크 `[[경로]]`는 렌더 단계에서만 처리 (자동완성 X).
- 툴바·인용 피커·자동완성은 모두 **범위 밖**. 향후 "지식 익스플로러" 트랙에서 다룬다.

## 폴더 구조 (Skill 형식)

파일·폴더명은 **한국어**. 마스터 문서가 전체 구조를 안내한다.

```
kb/
├── 스킬.md                                  ← 마스터 인덱스 (목차·구조 설명)
│
├── 해석론/                                  ← 인터프리테이션 프레임워크 8종
│   ├── 엄격해석.md
│   ├── 목적론해석.md
│   ├── 체계적해석.md
│   ├── 실질과세원칙.md
│   ├── 신의성실원칙.md
│   ├── 입증책임.md
│   ├── 유추해석.md
│   └── 문언해석.md
│
├── 직업군/                                  ← 업종별 가이드 (auditor가 모두 다룸)
│   └── 병의원/
│       ├── 개요.md                          ← 직업군 README
│       ├── 차량유지비.md
│       ├── 골프회원권.md
│       └── 헬스장회원권.md
│
├── 판례노트/                                ← 자주 인용하는 케이스 노트
│   ├── 조심2025구1960.md
│   ├── 조심2025부4364.md
│   └── 조심2025부4055.md
│
├── 용어집/                                  ← 세무 용어 사전 (인라인 링크용)
│   ├── 실질과세.md
│   ├── 신의성실.md
│   ├── 입증책임.md
│   ├── 필요경비.md
│   ├── 업무무관비.md
│   ├── 손금산입.md
│   ├── 손금불산입.md
│   ├── 부당행위계산부인.md
│   └── 가산세.md
│
└── 오류패턴/                                ← (사용자 작성 전용 — 빈 슬롯)
    └── 개요.md                              ← "여기에 작성하세요" 안내만
```

> 카테고리 키 = **폴더명 첫 세그먼트** (영문 토큰 매핑은 코드 enum에서만 사용).

### 시드 매핑

| 폴더 / 파일 | 시드 소스 |
|---|---|
| `스킬.md` | 신규 작성(목차·구조 설명) — 본 문서 기반의 한국어 요약 |
| `해석론/*.md` (8개) | `docs/02_analysis_findings.md` 분할 + `data/analysis/canon_examples.json`의 프레임워크별 인용 블록 |
| `직업군/병의원/개요.md` | `docs/04_decision_engines.md`의 병의원 섹션 |
| `직업군/병의원/{차량유지비,골프회원권,헬스장회원권}.md` | `prototype/data/conversations/clinic-{vehicle,golf,gym}.json`의 `topic.*` + 인용 케이스 목록 자동 생성 |
| `판례노트/조심2025구1960.md`, `조심2025부4364.md`, `조심2025부4055.md` | 현 대화에서 인용된 케이스 — `data/processed/all_cases.jsonl`에서 메타·요지 추출 |
| `용어집/*.md` | 신규 작성(짧은 정의 + 출처 표기). 핵심 9~10개. |
| `오류패턴/개요.md` | 신규 작성(안내문). 본 폴더는 사용자가 채워나간다. |

> 시드는 모두 `source: "seed"` 로 마킹되며 **읽기 전용**.
> 편집하려면 "확장(Extend)" 액션 → 사본을 `source: "user"`로 만들어 그 사본을 편집.

## 데이터 모델

```ts
// lib/kb-schema.ts (NEW)
export const KB_CATEGORIES = [
  "skill-master",
  "interpretation-framework",     // 해석론/
  "occupation",                   // 직업군/<업종>/
  "case-precedent",               // 판례노트/
  "glossary",                     // 용어집/
  "pitfall",                      // 오류패턴/
] as const;
export type KbCategory = (typeof KB_CATEGORIES)[number];

export type KbCitation =
  | { kind: "case"; caseId: string; label?: string }     // 조심2025구1960
  | { kind: "law"; ref: string; label?: string }          // 소득세법 §78의3
  | { kind: "external"; url: string; label: string };

export type KbStatus = "draft" | "published";
export type KbSource = "seed" | "user";

export interface KbDocument {
  id: string;                  // uuid
  path: string;                // 폴더 포함 경로, 확장자 제외. 예: "직업군/병의원/차량유지비"
  category: KbCategory;
  frontmatter: {
    title: string;
    summary?: string;
    tags?: string[];
    occupation?: string;       // category === "occupation" 일 때만
    caseId?: string;           // category === "case-precedent" 일 때
    framework?: string;        // category === "interpretation-framework" 일 때
  };
  body: string;                // markdown ([[경로]] 위키 링크 지원)
  citations: KbCitation[];
  source: KbSource;
  status: KbStatus;
  reviewer: string;
  createdAt: number;
  updatedAt: number;
}
```

- `path`는 unique. seed의 path는 안정.
- 사용자 신규 문서: 폼에서 카테고리 선택 → `<카테고리 폴더>/<title slug>` 자동 생성 (충돌시 suffix).
- URL 경로: `/audit/knowledge/<encodeURIComponent(path)>` — Next 가 한글 path를 처리(decodeURIComponent 필요).

## 스토어

```ts
// lib/kb-store.ts (NEW) — Zustand + persist("kb-store-v1")
interface KbState {
  documents: KbDocument[];                 // 사용자 작성/확장만 영속
  upsert(doc: KbDocument): void;
  remove(id: string): void;
  extendFromSeed(seedPath: string): KbDocument;     // user 사본 생성, path는 동일 폴더 내 새 slug
}
```

- 시드는 **영속하지 않음**. 매 로드마다 `lib/load-kb-seeds.ts`로 합성 → 메모리 머지.
- 노출 함수: `useKbDocuments()` → `[...seedDocs, ...state.documents]` (path 충돌시 user 우선).

## 시드 로더 — `lib/load-kb-seeds.ts`

- 시드 콘텐츠는 `prototype/data/kb/seeds/` 아래 실제 `.md` 파일로 둠(파일명 한국어).
- 빌드 타임에 raw string import (Next 16 / Turbopack의 asset module 처리는 **B3 진입 시 `node_modules/next/dist/docs/`에서 가이드 확인 후 결정** — AGENTS.md 지침).
- 각 파일의 frontmatter는 `gray-matter` 등 경량 파서 또는 자체 split.
- 시드 산출 함수: `getKbSeeds(): KbDocument[]` — `source: "seed"` 고정.

## UI

### `/audit/knowledge` — 인덱스 (마스터 표시)
- 메인은 `스킬.md` 렌더 (목차 + 구조 안내).
- 사이드바 KB 섹션에 **폴더 트리** (접기 가능):

```
▾ 해석론/
   엄격해석
   목적론해석
   ...
▾ 직업군/
   ▾ 병의원/
      개요
      차량유지비
      골프회원권
      헬스장회원권
▾ 판례노트/
   조심2025구1960
   ...
▾ 용어집/
   실질과세
   ...
▾ 오류패턴/   (사용자 문서 N건)

[+ 새 문서]
```

상태 배지: `seed` (회색) · `user` 점 · `draft` (노랑) · `published` (브랜드 그린).

### `/audit/knowledge/<path>` — 리더
- 상단: title · summary · 카테고리 배지 · seed/user 표시 · 갱신 정보.
- 본문: `react-markdown` 렌더 + 위키 링크 `[[경로]]` → 내부 라우트 변환.
- 우측 사이드: `citations`, frontmatter의 framework/caseId/tags, **이 문서를 인용한 라인 피드백**(B5에서 활성).
- 시드 문서: 우상단 **"이 문서를 확장하기"** → user 사본 생성 후 에디터로 이동.

### `/audit/knowledge/<path>/edit` · `/audit/knowledge/new` — 에디터 (v1)
```
┌─ Editor ─────────────────────────────┬─ Preview ──────────────────┐
│ 카테고리  [드롭다운]                  │ # Title                    │
│ 경로     [<폴더>/<자동 slug>] (편집)  │ summary                    │
│ Title    [.........................] │ ──                         │
│ Summary  [.........................] │ body 렌더 (위키 링크 포함) │
│ Tags     [chip][chip] +              │                            │
│ Citations [chip][chip] +             │                            │
│ Body                                  │                            │
│ ┌──────────────────────────────────┐ │                            │
│ │ markdown textarea                │ │                            │
│ │                                  │ │                            │
│ └──────────────────────────────────┘ │                            │
│ [draft 저장] [발행]                   │                            │
└──────────────────────────────────────┴────────────────────────────┘
```

- 카테고리 선택이 `path`의 첫 세그먼트를 강제. `직업군` 선택 시 두 번째 세그먼트(업종) 입력 추가.
- Citations 칩: 자유 텍스트 (`case` / `law` / `external` 종류만 선택). 케이스 피커는 **B6**.

## 라인 피드백 ↔ KB 교차 링크 (B5)

```ts
// lib/audit-schema.ts (변경)
interface LineFeedback {
  // ...
  relatedKbIds: string[];   // 신규, default []
}
```

- 라인 피드백 패널에 "관련 KB 문서 첨부" 액션 추가 (현 KB documents 자동완성).
- 참조 KB가 삭제되어도 피드백 보존 (UI: "삭제된 문서").
- KB 리더에 역방향 인용 섹션 — 대화별 그룹화.

## 카운트·내보내기
- 사이드바 트리 각 폴더에 사용자 문서 수 배지.
- 인덱스 우상단 **전체 내보내기** → `kb.json` (사용자 문서만). 시드는 레포에서 재생성.

## 검증 / 영속
- `kbDocumentSchema` (zod) — `lineFeedbackSchema`와 동일 톤. category·path 정합성 체크.
- localStorage 키: `kb-store-v1`.
- 하이드레이션 가드: `useKbHydrated()`.

## 인수 기준

**B3 (읽기 전용 KB)**
- [ ] `/audit/knowledge` 인덱스에서 `스킬.md` 마스터 렌더.
- [ ] 사이드바 폴더 트리 노출(접기/펴기), 시드 + user 통합.
- [ ] 한글 경로의 라우트 정상 동작 (`encodeURIComponent` / `decodeURIComponent`).
- [ ] 리더에서 마크다운 + 위키 링크 정상.
- [ ] 시드 문서는 편집 진입 차단, "확장" 액션만 노출.

**B4 (에디터)**
- [ ] 카테고리 선택 → path 자동 생성 + 충돌 처리.
- [ ] 시드 "확장" → user 사본 + prefill로 에디터 진입.
- [ ] draft / publish 토글, 트리 배지 갱신.
- [ ] 새로고침 후 영속, JSON export 정상.

**B5 (교차 링크)**
- [ ] 피드백에 KB 첨부/해제 동작.
- [ ] orphan 처리(삭제된 KB 표시).
- [ ] KB 리더에 역방향 인용 노출(대화별 그룹).
