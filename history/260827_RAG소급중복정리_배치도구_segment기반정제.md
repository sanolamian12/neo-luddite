# 260827 · RAG 소급 중복 정리(§3.1) — 배치 도구 구현 + 실측으로 발견한 오탐 문제 + segment 기반 정제

## 요약

`docs/doing/RAG_구조분석_및_개선로드맵.md` §4의 1번 우선순위(§3.1 소급 중복 정리)를 진행했다.
KB 전체를 훑어 유사도 0.85+ 클러스터를 찾는 배치 조회(admin API+화면)를 만들고, 프로덕션
DB(526건)에 실제로 돌려봤다. 그 결과 **원래 의심 신호(threshold 0.85 semantic clustering)만
쓰면 진짜 이중제출과 정당한 별개 코멘트를 구분하지 못한다**는 걸 발견했다 — union-find로
transitively 묶다 보니 클러스터 하나(최대 9건)에 "진짜 중복"과 "같은 대화의 다른 문장에
달린 정당한 코멘트"와 "합성 시나리오라 우연히 비슷한 다른 대화"가 뒤섞였다. 초기 설계대로
"클러스터당 가장 오래된 것만 남기고 나머지 기본 체크"를 그대로 뒀다면 390건 중 286건이
자동으로 정리 후보 표시됐을 것이다(대부분 오탐). `segment_id`(+`conversation_id`) 일치를
"진짜 재제출" 신호로 쓰도록 정제해 자동 체크를 45건(41개 그룹)으로 좁혔다. **실제 retired
처리는 아직 하지 않았다** — admin이 화면에서 확인 후 수동으로 확정해야 한다.

## 1. 구현

- `backend/api/rag/store.py`: `find_duplicate_pairs()`(self-join, threshold 이상 쌍) +
  `find_duplicate_clusters()`(union-find로 transitive 클러스터화, maxScore 내림차순) +
  `get_passages_by_ids()`.
- `backend/api/main.py`: `GET /api/rag/duplicate-clusters?threshold=0.85` 신설. 실제 정리는
  새 엔드포인트를 만들지 않고 기존 `/api/rag/retract`를 재사용(별도 삭제 경로 안 만듦).
- `backend/api/schema.py`: `DuplicateCluster`/`DuplicateClustersResponse`.
- `frontend/services/rag.ts`: `listDuplicateClusters()`.
- `frontend/components/admin/rag-duplicates-view.tsx` + `/admin/pipeline/duplicates` 페이지 +
  사이드바 "AI 코어 → 소급 중복 정리".

## 2. 실측으로 발견한 문제 — semantic clustering만으로는 오탐이 압도적

프로덕션 DB(active 526건)에 threshold 0.85로 돌리자 **104개 클러스터, 390건**(KB의 74%)이
잡혔다. 클러스터 크기 분포: 2건(39개)~9건(1개). 원래 의심됐던 3건(`51f80d4c`,`a570f3b6`,
`ec2779de`)을 포함한 클러스터를 까보니 6건이 묶여 있었고, 각각을 조사한 결과:

| id | segment_id | conversation_id | 판정 |
|---|---|---|---|
| `51f80d4c` | `asst_live-clinic-mreyniki_1_s2` | `live-clinic-mreyniki` | **진짜 중복**(a570f3b6 과 같은 segment, 같은 reviewer/auditor, 160ms 간격 — 더블클릭/재시도) |
| `a570f3b6` | `asst_live-clinic-mreyniki_1_s2` | `live-clinic-mreyniki` | 위와 짝 |
| `d0d6125b` | `asst_live-clinic-mreyniki_1_s1` | `live-clinic-mreyniki` | 다른 segment — 정당한 별개 코멘트 |
| `ec2779de` | `asst_live-clinic-mreyniki_1_s0` | `live-clinic-mreyniki` | 다른 segment — 정당한 별개 코멘트 |
| `b4151f1f` | — (session_eval) | `live-clinic-mrlshcnu` | **다른 대화** — 합성 시나리오라 문구만 비슷한 오탐 |
| `dff35aea` | — (session_eval) | `live-clinic-mreyniki` | 같은 대화지만 session_eval(총평) 단위라 별개 |

번들 임베딩(Q+A+C 통짜)이 질문(A) 텍스트에 지배되기 때문에, 같은 대화의 다른 세그먼트나
같은 시나리오 템플릿으로 생성된 다른 대화가 코사인 유사도 0.85+로 잡히는 게 구조적으로
불가피하다(§1.1 "임베딩 단위=Q+A+C 번들"의 파생 결과). union-find 로 transitive하게 묶다
보니 이 문제가 증폭됐다 — A~B가 진짜 중복이어도 B~C가 threshold를 넘으면 C(무관한 항목)도
같은 클러스터에 딸려 들어온다.

## 3. 정제 — segment_id 를 "진짜 중복" 신호로

프론트(`rag-duplicates-view.tsx`)의 기본 선택 로직을 클러스터 전체가 아니라
**`conversationId`+`segmentId` 가 일치하는 하위 그룹**만 보도록 바꿨다. 같은 segment 를
공유하는 항목이 2건 이상일 때만 "재제출 의심"으로 보고 가장 오래된 것만 남기고 자동 체크,
나머지(다른 segment/다른 대화)는 "유사 — 수동 확인 필요" 배지만 달고 체크 안 함. 실측
검증(python 시뮬레이션, 실제 store 함수로 재현):

```
clusters: 104
old default(클러스터당 최고령만 남김) 자동체크: 286건
new default(같은 segment 재제출만) 자동체크: 45건 (41개 그룹)
```

백엔드는 바꾸지 않았다 — 클러스터 조회 자체(어떤 게 서로 유사한지 보여주는 것)는 여전히
유용하고, admin 이 "유사하지만 정당한" 케이스도 훑어볼 수 있어야 하니 그대로 두고
**프론트 기본 선택만** 좁혔다.

## 4. 다음

- **아직 아무것도 retired 처리하지 않았다.** admin 이 `/admin/pipeline/duplicates` 에서
  직접 확인 후 확정해야 한다.
- 41개 그룹·45건이 실제로 얼마나 "진짜" 중복인지는 admin 육안 확인이 필요 — segment_id
  일치가 강한 신호이긴 하지만 100% 보장은 아님(예: 같은 segment 에 서로 다른 auditor가
  의도적으로 재평가를 남긴 케이스가 있다면 그것도 여기 걸린다. 이번 조사에서는 그런
  케이스를 못 찾았지만 배제는 못 함).
- 정리 후 §3.4(admin 승인/반려 워크플로우)로 자연스럽게 합류 예정 — 그때는 이 화면이
  "소급 정리"뿐 아니라 상시 승인 큐의 한 use case가 될 수 있다(로드맵 문서 §3.4 참조).
