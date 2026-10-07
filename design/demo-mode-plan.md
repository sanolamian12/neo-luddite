# Three act demo mode implementation plan

The [agreed story](three-act-demo.md) is implemented as a repeatable, stateful browser-local demo on the existing customer, expert and administrator routes. Open `/demo` to begin. The [UI audit](demo-ui-audit.md) retains the original gap inventory and records implementation evidence. This document is the agreed implementation contract and delivery record.

Scope updated 2026-10-07: show all three teaching methods and demonstrate only the existing-chat path. Support pulling the whole consultation or selected messages. Manual lesson creation and recording are not additional presentation scenes; audio capture, playback and transcription are outside this delivery.

## Delivery decision

Use one presenter tab and one isolated demo run. Enter at a new `/demo` launcher, then use the normal product routes with demo context. A compact presenter bar switches viewpoint, provides prepared input and restores named checkpoints. It does not replace product screens or automatically approve actions.

The demonstration remains browser-local. Scripted conversation turns are deterministic; lesson application, private/shared selection, review, batch membership, local KB activation and credit accounting change real demo state. The demo's answers must read that state so edits and publication have visible consequences.

Preserve the current luminous visual system. Reuse the expert directory, chat composer, transcript/lesson editor, sharing form, administrator detail and credit-table presentation. Add controls where the audit found missing interactions. Do not fork a second customer/expert/admin UI just for the presentation.

## Delivery record · 2026-10-07

- Added `/demo`, a validated run snapshot, write ownership with explicit tab takeover, view resume, prepared inputs and all 17 scene checkpoints. Reset remounts scene UI and invalidates old conversation/batch work. The normal account and normal persistence keys are preserved.
- Connected the canonical conversation to both customer chat and expert participation. Selecting a fictional expert changes the agent and participant identity within the same transcript. Takeover cancels pending AI; returning to AI and completing the consultation are separate actions.
- Added a source selector ahead of the existing session editor. Whole-session and selected-message inputs retain original IDs, speakers and source revision. One reviewed lesson reaches the existing private library, comparison and separate sharing workflow. Recording is visible as `준비 중`.
- Extended review with `approved` and `batched` states; ordinary individual publication keeps its prior behavior. Added batch list/detail routes, an immutable manifest, local activation, failure/retry, once-only author credit, retraction reversal and an attributed common-AI follow-up. The existing ledger table renders the new contribution source.
- Implementation lives in [demo domain](../frontend/lib/demo/domain.ts), [storage](../frontend/lib/demo/storage.ts), [runtime adapters](../frontend/components/demo/runtime.tsx) and [demo components](../frontend/components/demo/), with small integration points in the existing workspaces. [Domain tests](../frontend/lib/demo.test.ts) cover continuity, source selection, stale revisions, atomic persistence, credit idempotence, retraction and checkpoints.

The runnable path uses prepared Korean conversation responses and actual local state changes. The comparison uses the existing keyword retriever against before/after practice snapshots; the closing common-AI view reads incorporated shared proposals. Neither is a live model call. Recording, transcription, backend authorization, multi-device synchronization, actual RAG deployment and monetary settlement remain outside this implementation.

Verification: `npm test` passed 89 tests; the production build, focused ESLint and `git diff --check` passed. The existing `e2e/agent-navigation.spec.ts` passed all three tests against the production server. Browser rehearsal covered the complete demo on development and production builds, excerpt persistence, whole-session import, before/after output, selected sharing, update failure/retry, exact author credit, attributed retrieval, single-writer takeover, last-view resume, checkpoint restoration and interrupted-response retry. Desktop and 390px mobile screenshots are local artifacts in `output/playwright/demo-mode/`.

Main integration verification · 2026-10-07: reconciled the demo with the live chat and expert-studio changes at `11642e8`. Preserved live chat routing, server agent saving, room assignment, and disabled prototype contribution storage in live mode. The combined tree passed 94 unit tests, focused ESLint, prototype and live production builds, three prototype navigation tests and five HTTP-intercepted live integration tests. A full production demo replay retained the original thread and selected 3 of 9 source messages, completed failure/retry without early credits, and ended with KB version 1, two attributed credits and unchanged normal storage. Live tests used local intercepted transport, without production credentials or records.

## Demonstration contract

| Concern | Recommended first implementation |
| --- | --- |
| Setting | One fictional 병의원 consultation about a 태블릿 used at work and at home, with a 노트북 variation. |
| Expert identity | One stable fictional expert/agent pair, for example `윤서진 세무사 · 가상 인물`; two alternative fictional profiles make selection meaningful. Names are proposed fixture content. |
| Conversation | One canonical conversation ID and ordered transcript from common AI through expert AI and human participation. |
| Teaching | Show consultation, manual-writing and recording options. Select the completed Act 1 chat, show whole-session/selected-message controls, and create one lesson from a selected excerpt. Both source scopes must work. |
| Selective sharing | Share the reviewed reusable consultation lesson; leave one prepared, pre-existing lesson private. No second lesson is created live. |
| Review queue | The new submission plus two clearly marked prepared submissions from other fictional experts. One is approved; one is returned for revision. |
| Batch | Exactly the two approved submissions. Preserve author and submitted revision in its immutable manifest. |
| Credit example | Proposed demo-only rule: one incorporated contribution revision yields `+1 cr`; two incorporated revisions yield two ledger entries. Clearly label the rule as an illustrative unit, with no cash value or settlement. Production policy remains open. |
| Final proof | A common-AI follow-up reads the new active shared lesson and exposes its author/source reference. The private lesson remains unavailable to common AI. |
| Other methods | Preserve the existing manual-writing route. Add a recording option with an accurate availability label; it does not start capture or form part of the scripted path. |
| Timing | Approximately 12 minutes; actions advance on presenter input, not wall-clock deadlines. Short response/progress delays can be skipped. |

Keep personal names, lesson titles, IDs, response text and credit amounts in one versioned scenario fixture. Do not embed conflicting copies across components. The fixture version is saved with each run so an older saved run can be migrated explicitly or restarted without corrupting the current one.

## Scene sequence and visible proof

Scene IDs match the audit and become stable presenter checkpoints. `Continue` navigates within current state. `Restore checkpoint` is an explicit replacement of this run's state, not a normal navigation action.

| Scene | Viewpoint and route | Action | State or proof required to finish |
| --- | --- | --- | --- |
| A1 | Customer, `/` then `/chat/clinic?c=…` | Send first question. | Common-AI turn and original customer turn in one thread. |
| A2 | Customer, same chat | Supply usage/evidence details. | Context-specific expert suggestion after fact collection. |
| A3 | Customer, same chat | Select the fictional expert. | Selected expert/agent and a joined event; earlier messages remain. |
| A4 | Customer, same chat | Continue the consultation. | Expert AI uses that expert's existing teaching; expert shows as observing. |
| A5 | Customer, same chat | Introduce the missing-records complication. | Human attention requested for a visible reason. |
| A6 | Expert, `/audit/consultations?kind=participation&…` | Take over and send a direct reply; return to customer view. | The exact human message is visible in the original thread; AI is paused. |
| A7 | Expert, same consultation | Complete consultation and choose teaching. | Completed source snapshot with all speaker identities. |
| B1 | Expert, `/audit/agents/teach?…` | Show all three methods; choose `상담에서 배우기`. | Consultation, manual-writing and recording choices are visible, with accurate availability. |
| B2 | Expert, `/audit/agents/teach?method=session&…` | Pull A7's chat; show `전체 상담`, then use `일부 선택` for the main script. | Selected customer facts and human reply highlighted with a count, preserving original message IDs and order. |
| B3 | Expert, same teaching screen | Review the selected excerpt, add judgment and apply one lesson. | One private lesson linked to exactly the selected source messages; prepared private lesson remains intact. |
| B4 | Expert, `/audit/agents/preview?…` | Repeat a prepared probe before/after B3's lesson. | Same facts/question, two practice revisions, actual source and changed output. |
| B5 | Expert, `/audit/contributions?…` | Share only B3's lesson and submit its separate copy. | Submitted immutable revision; prepared private lesson and raw consultation excluded. |
| C1 | Admin, `/admin/knowledge-contributions` | Review the new and seeded items. | Two approved items, one returned; active KB still unchanged. |
| C2 | Admin, proposed `/admin/knowledge-contributions/batches` | Select approved items and create a batch. | Frozen manifest with two author/revision references. |
| C3 | Admin, proposed `/admin/knowledge-contributions/batches/[batchId]` | Run update. | Completed batch and a new active local KB version. |
| C4 | Expert, `/audit/ledger` | Show the selected expert's credit and open its source. | `+1 cr`, matching lesson/revision/batch, recorded once. |
| C5 | Customer, common-AI follow-up | Ask the variation and expand its source. | Active shared lesson is retrieved; shared author attribution is visible. |

The final common-AI question should use a separate follow-up conversation or an explicit common-AI preview. Do not silently turn the original expert consultation back into common AI after it was completed.

## Presenter controls

The new `/demo` launcher offers `처음부터 시작`, `이어서 보기` and an expandable list of scene checkpoints. Existing runs show the saved scene and last update. The launcher creates fixtures only within demo storage.

On participating routes, show a small persistent `데모` label and a collapsible presenter bar with the current act/scene, viewpoint, next suggested action, `예시 문장 넣기`, `대기 건너뛰기`, `체크포인트`, and `데모 종료`. Prepared input populates a real field; the presenter still sends, applies, submits, approves or incorporates with the product control.

The bar reserves layout space instead of covering the chat composer or form footer. On mobile, collapse it to a button opening a sheet. A collapsed bar retains the demo marker. Keep rehearsal notes and detailed step instructions out of the customer transcript.

Switching viewpoint changes only the effective demo actor and route. It preserves the conversation, unsent drafts, unsaved lesson work, selected items and scroll intent. Exiting demo mode returns to the original normal-session route/account. Opening unrelated normal routes does not grant a role or expose demo data.

## Run state and persistence

### One run owns the story

Use a versioned, validated snapshot such as `neo-demo-run-v1:<runId>`. Keep run metadata/index keys under the same explicit demo prefix. The snapshot contains the scenario version, snapshot revision, scene, identities, canonical conversations, private agent practice, teaching drafts/sources, contributions, batches, active KB snapshot, ledger and event history.

Persist domain actions and drafts at deliberate boundaries. Report failed writes without displaying a saved/completed state. A single snapshot write commits batch completion, active knowledge and credits together. Validate before replacing the persisted snapshot. This supplies consistency for a single-tab local demo; it is not a multi-client transaction system.

Existing normal keys must remain untouched. The current `resetPrototypeData` does not reset all participating stores and must not be used as the demo reset. Reset/restore replaces only the current run, including its source selections and lesson drafts. Never call `localStorage.clear()`.

### Reuse screens through explicit runtime adapters

Introduce a `DemoRuntimeProvider` above participating route shells and small adapters for effective identity, conversation access, expert practice, contribution board and credit data. Outside demo mode, these adapters delegate to existing stores and behavior. In demo mode, they read/write only the run snapshot.

Resolve and validate demo context before mounting actor-dependent stores or service-backed views. Current `entryChatStore` chooses its namespace at module initialization, the agent provider reads `window.localStorage` directly, and the contribution key is fixed. A query parameter alone cannot isolate those singleton writes. Refactor those access seams or provide explicit injected stores; do not change a global key after hydration has already started.

The existing role guard, shell labels, directory, lesson authorship, review authority and ledger must all use the same effective actor adapter. Preserve the normal account store instead of repeatedly logging in and overwriting its persisted role. In live builds, disable the demo override entirely before any route guard or service access.

Use existing route paths with a run parameter, for example `?demo=<runId>`, retaining `c`, `agent`, `method`, `review` and `contribution`. Extend route helpers to preserve context. A scene URL identifies a view of the run; it never implies that prerequisites were completed. Inconsistent deep links offer resume/restore actions. Ordinary Back/Forward changes the view, without replaying mutations or awarding credits.

A single presenter tab owns writes in version 1. Detect another tab opening the same run and require an explicit takeover or open a forked run; do not silently support concurrent editing. Storage events can invalidate a stale view, but they are not sufficient synchronization for all current stores. Multi-window customer/expert presentation is a later delivery unless explicitly prioritized.

## Conversation and agent behavior

### Canonical messages and independent states

Create a demo conversation domain using reusable segment/content types, with explicit authors `customer`, `common_ai`, `expert_ai`, `expert` and system events. Store stable IDs, actor/agent identity, timestamps and referenced knowledge/practice versions. Adapt it to a shared transcript renderer; do not label a human reply as ordinary assistant output to fit the existing two-role schema.

Track these separately:

- Consultation lifecycle: `open` or `completed`.
- Expert presence: `not_joined`, `observing`, `away`.
- Response control: `common_ai`, `expert_ai`, `expert`.
- Intervention request: `none`, `requested`, `handled`.

Selecting an expert preserves the thread, attaches an agent and adds the expert as observing. Taking over cancels any pending AI reply and changes control. Returning control to AI does not complete the consultation. Completing it freezes an eligible teaching source; it does not fabricate a final exchange.

Guard every delayed response with run ID, snapshot/conversation revision, pending-turn ID and controller. Clear pending work on role/scene reset, takeover, completion and unmount. Double clicks or retries cannot duplicate a turn. An interrupted turn after reload offers an explicit retry.

### Deterministic responses with real dependencies

Keep the prepared question sequence and recognized facts in scenario data. Include equipment/태블릿/노트북 keywords so the agreed opening does not fall through to today's generic reply. Supported prepared inputs map explicitly to facts. Arbitrary text stays in the transcript; it must not silently assert evidence or advance an unrelated scripted conclusion. Show a presenter recovery cue when input leaves the supported scenario.

Common AI first gathers the agreed facts and recommends an expert only at A2. Expert AI reads the selected expert's active practice, requests the expert-specific evidence and exposes the lesson used. Reuse the existing policy evaluator and case retrieval where applicable; add topic-specific fixture policy fields rather than attempting semantic interpretation of arbitrary settings.

At B4, retain the pre-teaching practice revision and compare it with the applied revision using the same probe/facts. Changes to the lesson's conclusion, questions or availability must affect the displayed result. Demonstrate personalization already present at A4 and further improvement at B4; do not imply B3's later lesson was available earlier.

At C5, common AI reads only the active incorporated KB snapshot. Review approval and batch preparation alone must not change its answer. Do not apply the current “every published item” overlay directly, since the demo introduces a separate incorporation step.

## Teaching from an existing conversation

Reuse the existing `PracticeTeaching`, `SessionTeaching`, lesson validation and separate sharing-copy workflow. Keep all three teaching choices visible at B1. Consultation is the demonstrated path; manual writing keeps its existing route. Add a recording choice with a concise availability label such as `준비 중` until implemented. No recording route, microphone permission flow, audio fixture or transcription integration is needed for this demo.

At B2, show the completed canonical Act 1 conversation in the existing source list, recognizable by title, participants and completion time. Carry the conversation reference from A7 so it is easy to locate without silently importing it. After opening it, provide:

- `전체 상담`: include all content messages, retaining speaker identity and chronological order. Keep join/control events visible as context, outside the teaching input.
- `일부 선택`: select relevant messages with checkboxes, highlighting and a selected count. Whole messages are the first implementation of “part of a session”; character-level clipping is not required. The main script selects the customer facts, missing-records question and expert's direct reply.
- A source preview and `선택한 대화로 초안 만들기` action. Disable creation for an empty selection. If facts or an expert reply are missing, explain what context to include; do not invent it. Allow the expert to inspect the full transcript while keeping excluded turns out of the lesson input.

Persist the source conversation ID, completed snapshot revision, selection mode and original selected message IDs with the draft and applied lesson. Keep the immutable full snapshot private for context inspection; pass only selected content messages to draft creation. Preserve their original actor/agent identity through the existing source-turn model rather than relying on freshly parsed text IDs. Selection order follows the conversation, regardless of click order.

Source selection and draft edits survive navigation/reload. Changing the selection after drafting requires an explicit draft regeneration, retaining the previous draft until replacement is confirmed; it cannot silently overwrite the expert's reasoning. Switching methods also preserves unfinished work. Reuse the existing review/apply contract at B3: review quoted facts and add judgment, scope and exceptions. Unspoken rationale is supplied by the expert.

Apply one new lesson and keep a separate prepared private lesson in the knowledge collection to make selective sharing visible. Shared proposals contain only the selected de-identified lesson content and attribution, with private source references kept private. The current raw transcript exclusion must remain intact.

## Review, batch update and credit

### Preserve three distinct decisions

Use a demo contribution lifecycle `draft → pending → approved → batched → incorporated`, with `changes`, `declined` and `retracted` branches. Store review reason/checks and the exact submitted revision. Preserve the normal prototype's current contribution behavior through its adapter; the demo should not migrate or republish normal records.

Reuse `ContributionPayload` and shared validation. Extract review validation from the existing publish operation, which currently publishes and grants eligibility in one call. Give reused detail components explicit action/status adapters so the demo can offer `검토 완료` and defer incorporation to a batch.

New proposed routes under `/admin/knowledge-contributions/batches` keep this workflow beside the contribution queue. Leave the existing `/admin/pipeline/batches` statistics page in place and link to it only when its overview is useful. Add `반영 대기` and `업데이트 이력` navigation in the shared-knowledge area.

### Batch manifest and update

A batch records its ID/name, reviewer, base/target KB version, creation/completion times and an immutable list of contribution ID + submitted revision + author + payload snapshot. Only approved current revisions can enter it. Pending/returned/declined entries are excluded; already incorporated identical revisions cannot be added again.

Validate the manifest when created and again before completion. A changed, retracted or conflicting item blocks the batch with an actionable reason. Version 1 permits one active update at a time per run. States are `prepared`, `applying`, `complete`, `failed`. Progress represents local validation/assembly/activation, labeled as a demo; it must not claim a remote embedding or deployment job occurred.

Commit the active KB snapshot and credited incorporations with the completed batch in one run write. A failure keeps the previous KB version active and issues no credits. On reload during `applying`, show interruption and retry; do not assume the update completed while the page was closed. Retrying uses the same manifest and operation identity.

### Credit ledger

Reuse `/audit/ledger` presentation and add a `kb_contribution` source representation with contribution ID, submitted revision, batch ID, KB version, author, demo credit-policy version and timestamp. The first prototype policy is `+1 cr` per incorporated revision, clearly marked illustrative. Use a stable award key derived from run + contribution + revision so retries or duplicate batch actions cannot grant a second award.

Balances derive from ledger entries, not a counter incremented by UI clicks. Credit belongs to the recorded author, even if the presenter is currently an administrator. A retraction keeps the original entry and adds one linked reversal; recompute the active knowledge snapshot so the retracted item is no longer retrieved. Retraction/reversal is a recovery check, not a required scene in the short presentation.

Add a link from `공통 지식 기여` to `기여 크레딧` and from each credit to its contribution/batch detail. Keep older audit/settlement rows supported outside demo mode. Credit provenance must be visible without opening an unrelated settlement workflow.

## Implementation phases

| Phase | Deliverable | Main touchpoints | Acceptance gate |
| --- | --- | --- | --- |
| 1 | Run foundation and minimal launcher | Proposed `frontend/lib/demo/` schema/fixtures/store/context, `/demo`, runtime adapters, role/route helpers | Start/resume/exit/reset a run; normal storage/account unchanged; reload and stale-tab handling proven. |
| 2 | Complete Act 1 | Existing entry chat/handoff/directory, shared transcript renderer, expert participation queue, policy adapter | Same customer thread through selection and real editable human reply; AI pause/resume and explicit completion. |
| 3 | Complete Act 2 | Existing teaching/library/preview/contribution UI, three-option chooser, whole-session/message selection | All methods visible; actual Act 1 source imported whole or in part; one applied lesson with source references; controlled before/after proof; selected sharing only. |
| 4 | Complete Act 3 | Existing contribution detail/admin queue/ledger, new batch list/detail, active KB reader | Review → batch → update → once-only author credit → common-AI retrieval; failure leaves old version active. |
| 5 | Presentation controls and rehearsal | Scene checkpoints, prepared text/source selection, presenter bar, responsive behavior, documentation | Entire 12-minute story can be run twice from reset, resumed at each act, and demonstrated without live-model or audio dependencies. |

Build the smallest complete data path in each phase before adding optional presentation effects. Avoid unrelated model-graph editing, legacy audit/settlement redesign or new dashboards. The existing widgets should operate on the demo state; screenshots or animations cannot substitute for a missing transition.

## Verification plan

Use focused state/domain tests for isolation, legal transitions, cancellation, source selection/identity, private/shared boundaries, batch eligibility, failure atomicity and idempotent credits. Exercise changes to lesson text so a hardcoded before/after cannot pass. Reuse relevant existing tests and run the normal regression suite after implementation.

Add browser regression coverage for the complete story and its material interruption points:

1. Original message IDs survive expert selection; expert AI and human replies retain distinct author labels; pending AI is canceled on takeover.
2. All three teaching options are visible in B1. A7's transcript, including the exact human reply, opens in B2. Whole-session import preserves all content turns; excerpt import includes only selected messages with original IDs, speakers and chronological order. Applying B3 leaves the prepared private lesson intact; only the selected sharing copy reaches the admin queue.
3. Same input before/after teaching shows the actual revised lesson. Review approval alone does not affect common AI. Completed incorporation does.
4. Two authors' approved items enter a batch; one returned item stays outside it. Retried completion produces exactly two credit entries and the correct per-expert balances.
5. Reload during chat, editing and update produces recoverable state. Checkpoint reset cancels delayed operations, removes only demo artifacts and leaves normal account/storage intact.
6. All role/scene links preserve run and object context through Back/Forward and direct links. Switching viewpoint cannot submit, publish or credit anything by itself.
7. Empty or insufficient source selections show actionable guidance. Selection and edited judgment survive Back/Forward and reload; changing scope cannot silently overwrite a draft. Excluded turns are absent from draft input, and no raw transcript enters the shared proposal. The visible recording option accurately reflects its implementation status.
8. Desktop and 390px mobile views keep the picker CTA, composer, lesson action and admin batch controls visible/reachable. Include resizing an already-open picker and mobile detail focus.

Validate the production build and production route transitions, focused ESLint, `git diff --check`, and representative screenshots. Rehearse with no external LLM/ASR/backend traffic. A backend outage must not break the deterministic demo; no microphone setup is required.

## Open choices and defaults

The story and planning scope are agreed. The proposed implementation defaults are a single presenter tab, local deterministic responses, one consultation-derived lesson, a prepared private lesson and an illustrative `+1 cr` unit. The main script demonstrates selected-message teaching while keeping whole-session import available. Audience, final duration, branded fictional names and actual reward policy can change those defaults later; keep them as fixture/configuration choices. Recording remains a visible product option with future implementation outside this demo.
