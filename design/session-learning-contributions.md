# Consultation learning and shared knowledge contributions

Status: implemented browser-local prototype, 2026-10-06. Independent finish-review disposition: SHIP; no material fixes requested. See the [verification record](session-learning-contributions-verification.md) for checked journeys and limits.

## Product intent

Experts collectively improve the service. Their authorship, revisions, review work, and accepted contributions must remain traceable and support future rewards. Consultation teaching and shared publication are separate choices. This implementation updates personal answer cases and questions; creating executable policy fields remains an explicit action in the existing policy workspace.

## Direction contract

THESIS: Turn completed consultations into reviewed lessons, then offer those lessons to the shared knowledge collection with visible authorship and review history.

OWN-WORLD: Extend the existing luminous Korean workspace, Pretendard, teal actions, solid reading and editing surfaces, and inherited light/dark tokens. Code-led local extension; no concept seed or new visual identity.

STORY: Choose a conversation or transcript, inspect source excerpts, explain missing judgment, manually review a contrasting scenario, and apply privately. Separately prepare a de-identified proposal, submit, revise, and follow its publication and credit record.

FIRST VIEWPORT: Teaching opens with two clear entry modes. Session learning places the transcript beside an editable lesson. Contributions open with a compact status summary and a readable proposal list; selected proposals show content, attribution, history, and next action.

FORM: Extend the existing teaching workbench and knowledge library. Add a directly routed contribution ledger and a separate administrator review queue. Small screens stack source and editor with reachable actions. No reward leaderboard or invented financial amounts.

FINISH: Independent review, documented implementation and limits, and comparison with the incumbent design system. Preserve `DESIGN.md` and its sidecar for this ordinary extension. No raster assets ship.

## Implemented routes and flows

| Surface | Route and context |
| --- | --- |
| Private learning | `/audit/agents/teach?agent=<id>`; defaults to 상담에서 배우기, with 직접 사례 들려주기 retained |
| Personal knowledge | `/audit/agents/knowledge?agent=<id>`; cases and questions each offer a separate shared proposal |
| Expert contribution ledger | `/audit/agents/contributions?agent=<id>`; lists the author's proposals across agents, with `&contribution=<id>` selecting a record |
| Prepare from personal knowledge | Contribution route with `&case=<id>` or `&question=<id>`; explicit action creates the shared draft |
| Administrator review | `/admin/knowledge-contributions`; submitted records, status filter, review and retraction |
| Shared retrieval demonstration | `/audit/agents/preview?agent=<id>`; published answer/correction cases supplement local rehearsal retrieval |

1. **Learn:** Choose a completed chat with a human expert reply, a resolved participation rehearsal with an expert reply, a pasted/TXT/MD transcript, or the labeled fictional sample. Confirm permission, then inspect the retained speaker-labeled source. The deterministic organizer copies client statements into the facts draft, expert question lines into questions, and the last non-question expert line into the conclusion. These are quotations to review, not verified facts or semantic extraction. Rationale starts empty and must be supplied by the expert, alongside scope, exceptions and retrieval keywords. Record a contrasting scenario and expected response and manually confirm review; no model executes this step. Applying reusable material creates or updates one personal case and its questions with source-session linkage. Session-only material can be kept as a private note and is blocked from reusable application. Use the agent's Save action to persist private source, draft and knowledge.
2. **Contribute:** From an applied lesson, personal case/question, or a blank proposal, create a separate payload containing reusable content, scope and supporting sources. Raw turns and private session objects are excluded. Editing this draft leaves personal knowledge unchanged. The author must confirm de-identification and sharing permission for each submission; edits reset these acknowledgments. Basic identifier-pattern and exact-content duplicate checks supplement manual review. Drafts and submission actions persist directly to the local ledger.
3. **Review:** The administrator queue contains submitted records. A reviewer other than the author records a reason and checks evidence, privacy/permission, duplicates/conflicts, and applicability before publication. A change request lets the same author edit and resubmit the same contribution as the next immutable submission snapshot. Decline and retraction retain attributed history. These are local role checks, not authenticated server authorization.
4. **Track:** The expert ledger shows status, author, submitted revisions, reviewer feedback, publication ID/version, linked revision and credit eligibility. Submission alone creates no credit. Accepted publication creates one author credit record; a duplicate publication action is rejected and retraction reverses eligibility while preserving the record. The prototype labels eligibility as 보상 검토 대상; it grants no money or points and reports no verified usage or outcomes.

## Data and retrieval contracts

Private session data lives in the selected expert's browser-local agent library. Stable session and lesson IDs retain provenance and make repeat application update the same knowledge. Imported sources require both client and expert speech; AI speech remains labeled separately. Limits are 40,000 transcript characters, 120 turns, 6,000 characters per turn and 20 retained source sessions per practice. TXT/MD imports additionally have a 160KB file limit. These limits bound a prototype; they are not a retention policy.

The shared ledger keeps an author, originating agent/source ID, mutable draft payload, optimistic entry version, immutable submitted snapshots, and attributed events. Each submitted revision records privacy and sharing acknowledgments. Review events preserve the check values and reason. The first publication records version 1 and the exact submitted revision; a correction is a separately reviewed contribution whose evidence identifies the target, not an automatic replacement of an earlier shared entry.

`withSharedKnowledge` builds an ephemeral overlay from currently published answer and correction cases, using the linked submitted revision. It carries contribution ID, author and publication version into rehearsal evidence and leaves the editable personal library unchanged. Retracted entries no longer enter the overlay. Published question contributions remain recorded and reviewed; they are not retrieved as answer cases or automatically converted into executable policy rules. Existing fact-completeness and policy checks still govern whether a retrieved case may supply an example answer.

Contribution mutations reread local storage and validate the expected entry version. A stale editor preserves its input and requires an explicit latest-content reload; unreadable existing ledger data is not overwritten. This is optimistic validation in one browser, not an atomic multi-client database transaction or a production privacy boundary.

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

The source/editor and ledger/detail layouts are local surface decisions. They stack at 800px and below, where selecting an expert or reviewer record scrolls and focuses its detail and exposes a list-return action. Source reading is bounded to a 350px scrolling region at that width. Existing agent navigation keeps the new contribution task reachable through the mobile selector. No new global tokens or raster assets were introduced; `DESIGN.md` and `.impeccable/design.json` remain unchanged. Preexisting documentation drift is outside this extension's scope.

Implementation: [session teaching](../frontend/components/audit/agents/session-teaching.tsx), [expert ledger](../frontend/components/audit/agents/practice-contributions.tsx), [shared detail](../frontend/components/audit/agents/contribution-detail.tsx), [administrator queue](../frontend/components/admin/knowledge-contributions.tsx), and [local styles](../frontend/components/audit/agents/knowledge-growth.module.css). Domain contracts live in [session learning](../frontend/lib/session-learning.ts), [contributions](../frontend/lib/knowledge-contributions.ts), [ledger persistence](../frontend/lib/contribution-store.ts), and [shared retrieval](../frontend/lib/shared-knowledge.ts).

The [verification record](session-learning-contributions-verification.md) records behavioral checks, focused lint/build evidence, desktop 1440×1000, mobile 390×844 and dark-theme captures, and the independent SHIP disposition. It distinguishes implemented behavior from backend work and prototype limitations.
