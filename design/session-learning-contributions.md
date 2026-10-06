# Consultation learning and shared knowledge contributions

Status: implemented browser-local prototype, 2026-10-06. The initial extension received an independent SHIP disposition. See its [verification record](session-learning-contributions-verification.md) for that review's journeys and limits, and the [navigation follow-up](agent-navigation-review.md) for subsequent interrupted-work, route and publication verification.

## Product intent

Experts collectively improve the service. Their authorship, revisions, review work, and accepted contributions must remain traceable and support future rewards. Consultation teaching and shared publication are separate choices. This implementation updates personal answer cases and questions; creating executable policy fields remains an explicit action in the existing policy workspace.

## Direction contract

THESIS: Turn completed consultations into reviewed lessons, then offer those lessons to the shared knowledge collection with visible authorship and review history.

OWN-WORLD: Extend the existing luminous Korean workspace, Pretendard, teal actions, solid reading and editing surfaces, and inherited light/dark tokens. Code-led local extension; no concept seed or new visual identity.

STORY: Choose a conversation or transcript, inspect source excerpts, explain missing judgment, manually review a contrasting scenario, and apply privately. Separately prepare a de-identified proposal, submit, revise, and follow its publication and credit record.

FIRST VIEWPORT: Teaching opens with two clear entry modes. Session learning places the transcript beside an editable lesson. Contributions open as an expert-wide destination with a compact status summary and a readable proposal list; selected proposals show content, attribution, history, save state and next action. Agent-save and agent-management controls stay in the agent workspace.

FORM: Extend the existing teaching workbench and knowledge library. Add a directly routed contribution ledger and a separate administrator review queue. Small screens stack source and editor with reachable actions. No reward leaderboard or invented financial amounts.

FINISH: Independent review, documented implementation and limits, and comparison with the incumbent design system. Preserve `DESIGN.md` and its sidecar for this ordinary extension. No raster assets ship.

## Implemented routes and flows

| Surface | Route and context |
| --- | --- |
| Private learning | `/audit/agents/teach?agent=<id>&method=session`; `method=manual` opens 직접 사례 들려주기; absent method defaults to session learning |
| Personal knowledge | `/audit/agents/knowledge?agent=<id>&collection=cases` or `collection=questions`; `case` or `question` selects the exact record; `q`, `status` and `page` retain list context |
| Expert contribution ledger | `/audit/contributions`; lists the author's proposals across agents; `contribution=<id>` selects a record and `filter=<status>` retains list state |
| Prepare from personal knowledge | Contribution route with `agent=<id>` and `case=<id>` or `question=<id>`; explicit action creates the shared draft; original-case/question return remains available |
| Legacy contribution link | `/audit/agents/contributions` redirects to `/audit/contributions` with query context intact |
| Administrator review | `/admin/knowledge-contributions`; submitted records, status filter, review and retraction |
| Shared retrieval demonstration | `/audit/agents/preview?agent=<id>`; published answer/correction cases supplement local rehearsal retrieval |

1. **Learn:** Choose a completed chat with a human expert reply, a resolved participation rehearsal with an expert reply, a pasted/TXT/MD transcript, or the labeled fictional sample. Source selection reveals and focuses the populated import panel; creating the lesson reveals its source heading. Confirm permission, then inspect the retained speaker-labeled source. The deterministic organizer copies client statements into the facts draft, expert question lines into questions, and the last non-question expert line into the conclusion. These are quotations to review, not verified facts or semantic extraction. Rationale starts empty and must be supplied by the expert, alongside scope, exceptions and retrieval keywords. Record a contrasting scenario and expected response and manually confirm review; no model executes this step. Applying reusable material creates or updates one personal case and its questions with source-session linkage and saves them with the private source and draft in the same action. A failed write preserves the input without marking application successful. “지식 모음 보기” selects the exact applied case. Session-only material can be saved as a private note and is blocked from reusable application.
2. **Contribute:** From an applied lesson or personal case/question, explicitly create a separate payload containing reusable content, scope and supporting sources. “새 지식 제안” always creates a blank proposal, including when opened from a source-preparation page. Raw turns and private session objects are excluded. Editing this draft leaves personal knowledge unchanged. Field changes autosave to the local ledger, independently of agent saving, and remain unsubmitted until “검토 요청”. The author must confirm de-identification and sharing permission for each submission; edits reset these acknowledgments. Basic identifier-pattern and exact-content duplicate checks supplement manual review. Preparation and selected records provide a list return and a link to the original case/question when it still exists; stale source links explain the missing record.
3. **Review:** The administrator queue contains submitted records. A reviewer other than the author records a reason and checks evidence, privacy/permission, duplicates/conflicts, and applicability before publication. A change request lets the same author edit and resubmit the same contribution as the next immutable submission snapshot. Decline and retraction retain attributed history. These are local role checks, not authenticated server authorization.
4. **Track:** The expert ledger shows status, author, submitted revisions, reviewer feedback, publication ID/version, linked revision and credit eligibility. Submission alone creates no credit. Accepted publication creates one author credit record; a duplicate publication action is rejected and retraction reverses eligibility while preserving the record. The prototype labels eligibility as 보상 검토 대상; it grants no money or points and reports no verified usage or outcomes.

## Data and retrieval contracts

Private session data lives in the selected expert's browser-local agent library. Before import, intake title, text, source type and permission choice belong to the agent draft. Client-side navigation retains them; “변경 저장” persists unfinished intake and lesson edits for reload. Changing the teaching method uses URL state, and continuing a manual draft restores its retained step. Replacing a working session lesson requires explicit discard confirmation. Both manual and session lesson application write the resulting agent library before showing completion; the private-note action follows the same save boundary. Stable session and lesson IDs retain provenance and make repeat application update the same knowledge. Imported sources require both client and expert speech; AI speech remains labeled separately. Limits are 40,000 transcript characters, 120 turns, 6,000 characters per turn and 20 retained source sessions per practice. TXT/MD imports additionally have a 160KB file limit. These limits bound a prototype; they are not a retention policy.

The private agent library and shared ledger have different save paths:

| State | Navigation within the mounted audit workspace | Reload |
| --- | --- | --- |
| Unfinished private intake, lesson or personal knowledge edit | Retained in the agent library provider | Restores only the last successful “변경 저장” or application/note save |
| Successfully applied lesson or saved session-only note | Retained; source and resulting knowledge/note are saved together | Restored from browser storage |
| Successfully autosaved shared draft | Retained independently of agent Save; still not submitted | Restored as a shared draft |
| Shared edit whose autosave failed | Working payload and base version retained transiently; “다시 저장” is available | Unsaved working copy is lost if the user proceeds with reload |

Private unsaved edits and failed shared working copies register a browser unload warning. That warning is not durable backup. A shared draft becomes an immutable submitted revision only after explicit “검토 요청” with current acknowledgments; private source storage never performs that submission.

The shared ledger keeps an author, originating agent/source ID, mutable draft payload, optimistic entry version, immutable submitted snapshots, and attributed events. Each submitted revision records privacy and sharing acknowledgments. Review events preserve the check values and reason. The first publication records version 1 and the exact submitted revision; a correction is a separately reviewed contribution whose evidence identifies the target, not an automatic replacement of an earlier shared entry.

`withSharedKnowledge` builds an ephemeral overlay from currently published answer and correction cases, using the linked submitted revision. It carries contribution ID, author and publication version into rehearsal evidence and leaves the editable personal library unchanged. Retracted entries no longer enter the overlay. Published question contributions remain recorded and reviewed; they are not retrieved as answer cases or automatically converted into executable policy rules. Existing fact-completeness and policy checks still govern whether a retrieved case may supply an example answer.

Contribution mutations reread local storage and validate the expected entry version. Failed autosaves preserve the working payload and base version in the audit provider across client-side route changes, show an unsaved state and prevent submission until saved. A stale editor preserves its input and requires an explicit latest-content reload, confirming before discarding unsaved changes; unreadable existing ledger data is not overwritten. Successful autosave clears the transient copy. This is optimistic validation in one browser, not an atomic multi-client database transaction or a production privacy boundary.

## Prototype and backend boundary

Browser-local examples, deterministic transcript organization, expert-authored rationale and manual contrasting-scenario review only. No LLM semantic extraction, speech recording/transcription, production KB or vector ingestion, model training, payouts, authenticated production access control, or verified outcome/usage metrics. Shared publication and credit eligibility are local demonstrations.

Backend handoff:

- **Private sources:** Define consultation-use consent, access, retention and deletion controls separately from permission to publish a de-identified proposal. Retain source provenance privately; do not put transcripts in shared payloads.
- **Identity and review:** Authenticate author ownership and reviewer authority on the server, prevent self-review, and verify redaction, supporting sources, duplicate/conflicting knowledge and applicability. Client roles and checkbox values are evidence inputs, not proof.
- **History:** Store immutable submitted revisions, acknowledgments, reviewer checks, decisions and attributed event history. Publish the reviewed revision with a stable shared identity/version, and preserve retraction history and retrieval-index versioning.
- **Concurrency and credit:** Validate optimistic versions atomically with each write. Make publication plus its credit event idempotent and transactional so retries cannot issue duplicate eligibility. Retraction must reverse eligibility and remove the entry from active retrieval consistently.
- **Rewards:** Obtain an approved reward policy before defining value, qualification or settlement. Accepted knowledge, corrections and review may inform that future policy; this first pass tracks expert-author publication credit only. No volume-based formula, money or points are invented.

## Design handoff and evidence

Compared `PRODUCT.md`, `DESIGN.md`, `.impeccable/design.json`, `luminous.css`, the existing practice controls and the finished learning/ledger/review components. The extension inherits Pretendard, Lucide icons, ink/muted/accent pairs, paper/solid/glass materials, field/divider boundaries, control/card radii, surface shadows and light/dark semantic status pairs. Local status badges use the incumbent 6px corners; no status-radius CSS token was added. The Reading Surface, Shared Foundation and Independent Axes rules remain intact: source text and editing use stable paper/solid surfaces; status always has a text label.

The source/editor and ledger/detail layouts are local surface decisions. They stack at 800px and below, where selecting an expert or reviewer record scrolls and focuses its detail and exposes a list-return action. Source reading is bounded to a 350px scrolling region at that width. The sidebar is the canonical workspace hierarchy, with six agent tasks and a separate expert-wide contribution destination. A native selector repeats only those six agent tasks when the sidebar is hidden or mobile; contributions remain reachable through the workspace drawer. The selector reuses paper, field-boundary and control-radius tokens, and return links/save status reuse the accent. Source selection, import and manual step changes bring the relevant heading into the viewport and focus it. No new global tokens or raster assets were introduced; `DESIGN.md` and `.impeccable/design.json` remain unchanged. Preexisting documentation drift is outside this extension's scope.

Implementation: [session teaching](../frontend/components/audit/agents/session-teaching.tsx), [expert ledger](../frontend/components/audit/agents/practice-contributions.tsx), [shared detail](../frontend/components/audit/agents/contribution-detail.tsx), [administrator queue](../frontend/components/admin/knowledge-contributions.tsx), and [local styles](../frontend/components/audit/agents/knowledge-growth.module.css). Domain contracts live in [session learning](../frontend/lib/session-learning.ts), [contributions](../frontend/lib/knowledge-contributions.ts), [ledger persistence](../frontend/lib/contribution-store.ts), and [shared retrieval](../frontend/lib/shared-knowledge.ts).

The [initial verification record](session-learning-contributions-verification.md) records behavioral checks, focused lint/build evidence, desktop 1440×1000, mobile 390×844 and dark-theme captures, and that extension's independent SHIP disposition. The [navigation follow-up](agent-navigation-review.md) owns the current interrupted-work, production-transition and publication evidence. The production regressions in [agent-navigation.spec.ts](../frontend/e2e/agent-navigation.spec.ts) cover teaching intake/save/resume, knowledge search/selection through history, and applied knowledge opening its exact source with a separate autosaved proposal. These records distinguish implemented behavior from backend work and prototype limitations.
