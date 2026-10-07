# Demo UI readiness audit

The three-act story is agreed and its browser-local demo is now connected at `/demo`. This document preserves the original UI inventory and records the implementation follow-up. The [story](three-act-demo.md) defines the presentation; the [implementation plan](demo-mode-plan.md) records the delivered runtime and boundaries.

Checked 2026-10-06 against the current working tree and a development server at `http://localhost:3015`. Browser checks used synthetic data in isolated Playwright sessions. Desktop viewport was 1440 × 1000; the customer/expert-picker mobile check used 390 × 844. Existing uncommitted landing-page changes were included in the observed app and left untouched.

Scope updated 2026-10-07: show all three teaching methods, but execute only teaching from the existing chat, using the whole session or selected messages. B1–B3 now cover method choice, source selection and lesson review/application. Targeted source inspection confirms the existing importer copies the full transcript without a message selector; the chooser exposes only consultation and manual writing. Recording intake is no longer required for this demo. Browser evidence below remains the original audit, not a new run.

## Implementation follow-up · 2026-10-07

| Area | Delivered UI and verified behavior |
| --- | --- |
| A1–A7 | One customer transcript through common AI, expert selection, expert AI and human reply. Browser checks retained the first message ID across the role switch and pulled the exact human reply into teaching. |
| B1–B3 | All three method choices are visible. The completed chat supports whole-session or selected-message import. The browser selected three of nine content messages and retained that selection after reload on the production build. The existing editor applied the resulting lesson. |
| B4–B5 | The same probe produced a changed response from the applied lesson. A separate sharing copy was edited and submitted; the prepared private lesson stayed outside the contribution board. |
| C1–C5 | Reviewed two authors' proposals, returned the third, created a two-item batch, activated KB version 1 and recorded two separate `+1 cr` entries. The expert ledger showed only that expert's entry. The common-AI follow-up displayed the contributed lesson and author. |
| D1–D2 | Launcher, presenter viewpoint links, prepared inputs, last-view resume and scene restoration operate on run-prefixed storage. The browser's non-demo sentinel remained unchanged; no normal account/chat/agent/contribution keys were created during the complete isolated flow. |

The complete sequence was exercised on development and production builds. Production verification also exercised an update failure before retry: KB version and credits stayed at zero until successful incorporation. Source selection and the final common-AI exchange survived reload. Single-writer takeover and last-view resume passed. A separate checkpoint run imported all nine content messages; reloading an interrupted response preserved the question and exposed an explicit retry. Desktop inspection used 1440 × 1000 and mobile inspection used 390 × 844; teaching and batch actions remained reachable with no document-width overflow in teaching. The fresh mobile expert-picker action was visible at y=764–806 within the 844px viewport.

New local screenshots are in `output/playwright/demo-mode/`. These are ignored verification artifacts. The sections below are the pre-implementation audit and its original evidence, not a statement that those gaps remain in demo mode.

### Experience refinement verification · 2026-10-07

The refreshed expert directory uses three generated fictional portraits, an explicit selection confirmation, an animated in-thread handoff, a personalized agent welcome and a clickable expert profile. Customer and expert workspaces have distinct mint/blue identities; expert conversations put the customer and avatar on the left and expert replies on the right. Replies reveal progressively. Reload/resume preserved the partial response without duplication, and human takeover retained the visible prefix while stopping the AI.

The teaching layout defect came from the studio's `width: 100%` input rule also targeting checkboxes. Excluding checkbox/radio inputs and fixing transcript checkboxes to 18px restored the text column: measured text width was 1,072px on desktop and 294px at a 390px mobile viewport, compared with approximately 12px before the fix on desktop. The mobile expert-picker confirmation remained fully visible at y=744–789 in an 844px viewport.

Verification passed 91 unit tests, focused ESLint, the production build and three existing production navigation tests. A fresh three-act browser replay selected three of ten transcript messages, applied and shared the lesson, exercised batch failure/retry and produced two correctly attributed credit entries. Desktop/mobile screenshots, reduced-motion rendering, profile dialogs and message alignment were inspected; the production browser reported zero console errors or warnings. Updated captures use `final-*` and `refined-smoke-*` filenames in the same artifact directory.

Release integration on the current `main` also passed 96 unit tests, prototype and live production builds, three prototype navigation tests and five live transport regression tests. The integrated three-act replay and desktop/mobile teaching and expert UI checks passed; unrelated landing and video work stayed outside the release.

### Avatar and conversation follow-up · 2026-10-07

Added a common-AI character, three illustrated expert-agent counterparts and a customer portrait, with generated-asset provenance in [demo avatar prompts](demo-avatar-prompts.md). The agent avatar follows the selected expert through chat and teaching; AI labels distinguish the illustrated agents from direct human replies.

The next prepared sentence is visible beside the composer. **문장 넣기** fills and focuses it without sending, and existing drafts remain editable without being replaced. Expert replies now queue a brief customer typing state and a prepared response. The browser verified one customer reply after reloading mid-typing, a second expert/customer exchange, and all thirteen content messages becoming available in teaching. Unit checks cover duplicate completion, manual-input cancellation, AI handback and consultation completion.

The local follow-up passed 94 unit tests, focused lint, a production build, three production navigation tests and the complete three-act production replay, including batch failure/retry and two attributed credit entries. Desktop/mobile checks confirmed visible prompt actions and the original teaching text layout.

Release integration on the current `main` passed 99 unit tests, focused lint, both prototype and live production builds, three prototype navigation tests and five live transport regression tests. The integrated three-act replay also passed with no browser console errors or warnings; existing server save and room-assignment controls remain intact.

## Original screen and state inventory

`Reuse` means the relevant UI and local interaction exist. `Extend` means a related surface exists but needs new states, data or connections for this story. `Add` means the required surface or interaction is absent. These labels describe readiness for this demo, not production readiness.

| Scene | Required UI | Status | Existing surface and evidence | Required work |
| --- | --- | --- | --- | --- |
| A1 | First question and common-AI chat | Extend | `/` → `/chat/clinic?c=…`; submitted the agreed tablet question in the browser. | Use the tablet scenario's facts and dialogue. Current sample asks what work/transaction the user means despite their question already saying so. |
| A2 | Contextual expert suggestion | Extend | `EntryResponse` / `ExpertHandoffBlock`; visible in customer chat. | Trigger after the intended fact-gathering exchange. `withSampleResponseUi` currently attaches a suggestion and a sample verdict card to every otherwise unstructured AI reply. |
| A3 | Expert comparison and selection | Reuse | Search, specialty/status filters, selection and pagination work in `ExpertDirectory`. Selected a profile on desktop; opened the picker on mobile. | Seed a consistent fictional expert and show their approach. Selection must attach the expert to the existing thread instead of ending at a request. |
| A4 | Expert-agent identity and expert present in the same chat | Add | Customer message schema has only `user` and `assistant`; customer view has no selected-agent or participant state. | Agent identity, participant strip, context-carryover event and joined/observing status. Preserve the original conversation and messages. |
| A5 | A more specific agent response and knowledge reference | Extend | `/audit/agents/preview` supports policy inputs, private/shared cases and an evidence panel. Browser run showed fact questions and referenced sample knowledge. | Render this behavior in the customer thread; consume the selected expert's saved lesson and policy. Keep the structured-input debugging form in the expert preview. |
| A6 | Expert queue, takeover, reply and AI pause | Extend | `/audit/consultations?kind=participation`; requested intervention, took over and sent a human reply in the browser. | Connect the queue to the customer conversation. Distinguish joined, replying, returned-to-AI and completed states. |
| A7 | Complete this conversation and teach from it | Add | Existing rehearsal can return control to AI. Existing room UI has a separate close action. | Explicit consultation completion and `이 상담으로 가르치기` linked to the canonical customer transcript. |
| B1 | Show three methods and choose consultation teaching | Extend | `PracticeTeaching` exposes `상담에서 배우기` and `직접 사례 들려주기`. The manual four-step wizard exists; session intake explicitly accepts text only. | Add a visible recording option with an accurate availability label. Select consultation teaching for the demo; preserve the existing manual path without requiring a second live lesson. |
| B2 | Pull an existing chat, whole or selected messages | Extend | `SessionTeaching` lists closed rooms and resolved rehearsals, then copies all their messages into the intake. No message-selection control or original-message reference mapping exists. | Supply A7's canonical transcript; add `전체 상담` / `일부 선택`, message highlighting/count and a selected-source preview. Retain original IDs, speakers and order. |
| B3 | Review and apply the selected source as one lesson | Extend | `/audit/agents/teach?method=session`; imported the saved rehearsal with customer/AI/expert labels, added rationale/scope/variation, and applied a private lesson in the browser. | Reuse the editor with B2's selected source only; link the applied lesson to those original messages and retain the full private source for context inspection. |
| B4 | Private library and before/after agent test | Extend | `/audit/agents/knowledge` edits knowledge; `/audit/agents/preview` retrieves current practice cases. Applied knowledge and explicit preview execution were exercised; this audit did not perform a controlled before/after comparison. | One-click repeated question using identical facts and two practice revisions; show the actual lesson used. The “different situation” section in session teaching is a manual review, not a generated test. |
| B5 | Selectively share one private lesson | Reuse | `/audit/contributions`; created a separate sharing copy from the applied lesson, supplied a synthetic source, acknowledged sharing and submitted revision 1. | Seed an additional unshared lesson and make the contrast easy to see. Preserve the current private/source/shared separation. |
| C1 | Admin review with revision and author | Extend | `/admin/knowledge-contributions`; opened the exact B5 submission, checked review fields and published it locally. | Add `검토 완료 · 반영 대기` distinct from publication. Preserve the review reason/checks and submitted snapshot. |
| C2 | Select reviewed items and assemble a batch | Add | The existing admin review has single-item actions, no batch selection or manifest. | Eligible-item selection, author/revision summary, batch name, exclusions and manifest confirmation. |
| C3 | Run the RAG update and inspect its version | Add | `/admin/pipeline/batches` actually renders `RagOverviewView`: statistics, source distribution and a global toggle. Inspected in browser. `/admin/pipeline/versions` renders infrastructure information. | Dedicated batch detail, update progress/failure/retry, active KB version and completed update history. Route names alone are not evidence of these capabilities. |
| C4 | Expert contribution credit and provenance | Extend | New contribution detail shows `보상 검토 대상`. Separately, `/audit/ledger` has numeric `cr`, balances and history; browser showed an empty ledger. | Connect incorporated contribution revision + batch + author to a credit entry. Add a discoverable link: the current expert sidebar does not expose the legacy ledger. |
| C5 | Common AI uses the contributed lesson | Add | `withSharedKnowledge` is used in expert rehearsal. Customer `sampleResponse` does not consume the contribution board. | Read the active batch snapshot in common chat and show source/author attribution after incorporation. |
| D1 | Demo start, role switching and guided cues | Add | `/login` has sample/empty/slow/error scenario controls. Role changes require logout/login; there is no presenter controller. | A demo launcher and compact presenter controls on existing routes. |
| D2 | Resume, scene checkpoint and isolated reset | Add | Current persistence is split across separate stores; sample reset does not reset the expert agent library or shared-contribution board. | A coherent run snapshot, named checkpoints and run-scoped reset. |

## Browser evidence

The following interactions were exercised through the existing UI:

1. Asked the tablet question as a guest, read the sample response, opened the expert picker and selected a profile.
2. Logged in as `auditor`, stepped through the rehearsal's common-AI/expert-selection screens, ran its structured-fact preview, requested direct participation and sent an expert reply.
3. Returned control to AI and saved. Loaded that rehearsal from session teaching; its three speaker-labeled turns included the exact human reply sent above.
4. Added rationale, scope, keywords and a manually reviewed variation; applied the lesson and created its separate sharing draft. Submitted the draft.
5. Opened the manual teaching method. It initially showed the completed session-derived lesson; `다음 사례 가르치기` opened a blank case.
6. Opened the existing credit ledger and observed its independent empty balance/history.
7. Logged out and logged in as `admin`; found the exact submitted lesson, reviewed it and published it locally. The result retained author, submitted revision, publication version and credit eligibility.
8. Opened the existing RAG page and confirmed it has statistics/toggle UI, not a batch builder.

All review acknowledgments and publication actions above concern synthetic browser-local records created for this audit. They establish UI behavior, not expert legal review or deployment.

Local screenshots are under `output/playwright/demo-ui-audit/` and are ignored artifacts, not shipped assets:

| Capture | Evidence |
| --- | --- |
| `01-customer-chat.png` | Generic sample reply and immediately shown handoff. |
| `02-expert-picker.png` | Existing desktop directory with selected expert. |
| `04-agent-preview.png`, `05-human-reply.png` | Rehearsal evidence and a distinct human response. |
| `06-session-lesson.png` | Original speaker-labeled transcript beside the lesson editor. |
| `07-shared-submission.png` | Submitted sharing copy with author/revision. |
| `08-manual-teaching.png` | Blank manual case after explicitly starting a new lesson. |
| `09-existing-credit-ledger.png` | Existing numeric credit UI with no linked new contribution. |
| `10-admin-review.png`, `11-individual-publication.png` | Single-item review and resulting eligibility record. |
| `12-existing-rag-page.png` | Statistics page at the misleadingly named `/batches` URL. |
| `13-mobile-picker-fresh.png` | Fresh mobile picker with its CTA fully in the viewport: top 770px, bottom 814px in 844px height. |

One capture made by shrinking an already-open desktop picker (`03-expert-picker-mobile.png`) showed its footer clipped. A fresh mobile opening was visible as measured above. Include open-popover viewport changes in verification; this is a resizing finding, not evidence that every mobile opening is broken.

The source/lesson and admin detail screenshots show long forms extending below the first viewport. They are usable scrolling surfaces, but presenting every field live would consume the available demo time. Presenter cues should fill prepared text into real fields and focus the next relevant section, while the presenter still reviews and applies it.

## Integration findings that affect the plan

- **Conversation models are separate.** Customer chat uses `EntryConversation` with only user/assistant messages. Expert rehearsal keeps its own `Review.messages` with client/agent/expert roles. Human rooms are a third collection with an AI-history reference. Rendering all three on different pages does not establish one conversation.
- **Resolved is overloaded.** `returnToAgent` sets a rehearsal to `resolved`; session teaching treats resolved rehearsals with human replies as completed sources. The demo needs independent controller and completion fields.
- **Teaching imports the entire transcript.** Source buttons flatten all messages to text and `importSession` assigns new turn IDs. Add an explicit selection before draft creation and retain a mapping to the original messages. Unselected messages must not silently enter the draft; inspecting full context is a separate action.
- **Expert identities differ across surfaces.** Directory fixtures display `샘플 세무사 1`, while the default expert account displays `평가자`. Use a single identity fixture across picker, agent, human message, lesson, submission and credit.
- **Persistence is not one demo session.** Entry chat uses `prototype-entry-chat-v1:<scenario>`, agents use `neo-agent-studio-v1:<owner>`, contributions use `neo-knowledge-contributions-v1`, and legacy collections use `neo-luddite-prototype-v1:<scenario>`. The latter scenario is selected via `sessionStorage`; account login is another shared key. Prefixing only the entry chat is insufficient isolation.
- **Tab synchronization varies.** The contribution board listens for storage events, while the prototype backend uses listeners within its own page instance. There is no coherent multi-tab session. A single presenter tab should be the first delivery target.
- **Existing service buttons may be unsupported.** The local backend supports a small RPC set. Consultation acceptance (`transition_consultation`) and room closure (`close_room`) are not implemented there. The demo must have explicit local transitions instead of assuming existing room buttons will complete the story.
- **Publication currently also grants eligibility.** `reviewContribution(..., "publish")` changes the item to published and adds credit eligibility immediately. Batch approval must not call that operation as-is.
- **Two credit models exist.** `Contribution.credit` records eligibility without an amount. `LedgerEntry` records a numeric amount and balance for audit/session-evaluation/settlement/manual sources; it has no KB-contribution/batch source. Reuse the ledger presentation, with an explicit new source type.
- **Shared retrieval is limited.** Currently published answer/correction cases enter the expert preview overlay; published question contributions do not become answer cases. Demo support for shared questions must be explicit if shown. Use an answer-case contribution for the agreed story.

## Source map

| Area | Current files |
| --- | --- |
| Entry and identity | [entry chat](../frontend/lib/entry-chat.ts), [entry store](../frontend/lib/entry-chat-store.ts), [message schema](../frontend/lib/conversation-schema.ts), [sample response](../frontend/lib/sample-response.ts), [customer UI](../frontend/components/chat/local-chat-experience.tsx) |
| Expert selection | [handoff](../frontend/components/chat/expert-handoff-block.tsx), [directory](../frontend/components/expert/expert-directory.tsx), [owner snapshot](../frontend/lib/entry-chat-owner.ts) |
| Rehearsal and teaching | [rehearsal/takeover UI](../frontend/components/audit/agents/practice-rehearsal.tsx), [practice transitions](../frontend/lib/agent-practice.ts), [session teaching](../frontend/components/audit/agents/session-teaching.tsx), [manual teaching](../frontend/components/audit/agents/practice-teaching.tsx), [agent provider](../frontend/components/audit/agents/agent-library.tsx) |
| Sharing and review | [expert contribution UI](../frontend/components/audit/agents/practice-contributions.tsx), [review detail](../frontend/components/audit/agents/contribution-detail.tsx), [admin queue](../frontend/components/admin/knowledge-contributions.tsx), [contribution domain](../frontend/lib/knowledge-contributions.ts), [persistence](../frontend/lib/contribution-store.ts) |
| RAG and credits | [shared retrieval](../frontend/lib/shared-knowledge.ts), [RAG overview](../frontend/components/admin/rag-overview-view.tsx), [ledger UI](../frontend/components/auditor/ledger-view.tsx), [ledger schema](../frontend/lib/poc-schema.ts) |
| Demo boundaries | [prototype backend/reset](../frontend/lib/prototype/backend.ts), [scenario controls](../frontend/components/prototype-controls.tsx), [role guard](../frontend/components/auth/role-guard.tsx), [account store](../frontend/lib/account-store.ts), [expert sidebar](../frontend/components/layout/expert-sidebar.tsx) |

## Verification limits

This was a UI readiness audit on the development build. It exercised the rehearsal-to-teaching-to-individual-publication path and inspected the other named surfaces. It did not execute the missing batch flow, customer-thread handoff, real audio capture, live transcription or credit payout. Mobile inspection covered customer chat and expert selection; full expert/admin mobile verification belongs to implementation acceptance. No application code was changed and no new application tests or production build were needed for this documentation pass.
