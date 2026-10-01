# Structured policy and rehearsal contract

Iteration 2, 2026-10-01. This is the frontend prototype's integration seam. No server endpoints, live extraction, shared corpus ingestion, publication, or model execution were added.

## Data ownership

`Agent.practice.rules` contains up to 30 version-1 rules. Rules and fields carry stable IDs. A rule's `version: 1` identifies its schema, not a publication revision. `agent-policy.ts` is the schema and deterministic evaluator. Server ownership, revision checks, draft/active versions and audit logs remain integration work.

Shared knowledge (`origin: sample` in this prototype) is platform-managed and absent from the expert's editable list. The prototype contains two synthetic shared cases, not the backend's 1,000-item corpus. Rehearsal retains the selected case ID and shows its provenance. Existing samples edited by an expert migrate to `origin: expert` without losing content or IDs. Migration is persisted on explicit Save. Knowledge is not a source of observations about the current client.

## Rule representation

```json
{
  "version": 1,
  "id": "equipment",
  "name": "장비 구입 상담",
  "enabled": true,
  "keywords": ["장비", "구입"],
  "match": "any",
  "fields": [
    { "id": "purpose", "label": "사용 목적", "question": "어떤 용도로 사용하시나요?", "required": true }
  ],
  "followUp": { "maxRounds": 1, "scope": "conversation", "onUnknown": "skip", "afterLimit": "hold" },
  "conflicts": { "enabled": true, "fieldIds": ["purpose"], "action": "human" },
  "exceptions": [
    { "id": "personal", "fieldId": "purpose", "operator": "contains", "value": "개인", "action": "human" }
  ]
}
```

Keywords select a topic; they do not count as facts. `any` needs one match, `all` needs every distinct nonblank keyword. The highest matching-keyword count wins; ties use saved rule order. Exactly one rule runs. Invalid matched rules withhold the answer and report their errors. This deliberately limited matching does not claim semantic relevance.

Fields define the information to collect and its follow-up question. Required fields must all be known; optional fields cannot compensate for missing required fields. Expert-authored knowledge questions can be copied into a rule. A copy keeps its own wording and is not silently synchronized afterward.

## Evaluation input

```json
{
  "query": "장비를 구입했습니다",
  "facts": { "purpose": { "client": "업무용", "document": "업무용", "unknown": false } },
  "rounds": 0,
  "asked": { "purpose": 0 }
}
```

A production fact-collection service must supply structured observations and provenance here. The rehearsal exposes them as manual inputs; it does not extract them from the question. Changing the question starts a new local test and resets facts and counters; changing facts preserves counters. A new conversation resets the rehearsal. In-memory rehearsal state survives route navigation, but only saved knowledge, settings, teaching drafts and participation threads survive reload.

- Nonblank client or document values can establish a fact. `unknown: true` overrides both and keeps it missing. Turning unknown off restores supplied observations.
- Comparison checks only selected identical field IDs with known values from both client and document. It trims text, collapses whitespace and ignores case; dates, amounts and meaning are not normalized. A missing source is not a conflict.
- Exceptions use `equals`, `not_equals` or `contains` against client text, falling back to document text. Missing/unknown text matches no exception, including `not_equals`.
- Evaluation order is validation, missing-fact accounting, conflicts, exceptions, sufficient facts, unknown fallback, then follow-up limits. Multiple exceptions choose human if any requires it. Conflicts take precedence over exceptions.
- Follow-up limits are 0–3. A batch of several questions counts as one conversation round and one attempt for each asked field. `recordQuestions` advances counters only when questions are returned. `skip` never asks an unknown field again; it does not mark that fact complete. `human` recommends participation for missing required facts marked unknown.
- After exhaustion, the configured action is hold or recommend human. Both withhold the ordinary conclusion. Human participation is still explicitly requested by the client.

## Evaluation output and handoff

`PolicyResult` has `status` (`ready`, `ask`, `hold`, `human`, `no_rule`, `invalid`), `ruleId`, missing field IDs, proposed questions with field IDs, conflict field IDs, exception IDs, a reason, and a readable trace. `rehearsePolicy` adds an eligible keyword-matched answer case, provenance and client observations. A ready policy with no eligible case still withholds the answer. A matching case supplies an illustrative stored answer; this does not establish that its judgment semantically applies to every observed value.

The participation record carries observations, case ID, reason, trace and messages. The UI shows common AI, expert AI and direct expert replies distinctly. Taking over pauses AI; returning control explicitly resumes it. Local reviews are scoped to the saved agent and demo expert. This is not an authenticated production authorization boundary.

## Backend work to agree separately

Connect authenticated agent IDs and revisions to server storage; map actual fact-collector output into observations and attempt counters; provide shared and personal retrieval with source IDs; interpret these supported operators in the backend; add persistent human-control state and real delivery. Free-text professional instructions and graph changes require their own execution and validation design. Supported policy settings can be interpreted as data without generating code on every edit. Adding a new operator or changing actual orchestration still requires implementation. No provider capability is ruled out by this frontend choice.

The advanced page keeps existing add/delete stage and edge editing plus separate graph simulation. Drag-and-drop and language-to-code orchestration are deferred. A visual graph edit does not currently change backend execution.
