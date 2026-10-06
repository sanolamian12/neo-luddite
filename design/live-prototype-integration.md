# Live and prototype integration

2026-10-06. Approved scope for this delivery: S0 merge plus S1 structured entry-chat responses. S2 consultation learning, S3 contribution review and S4 room restyling remain separate stages.

Mode: Operate. Extend the approved Luminous system using the existing response cards, source badges and workspace navigation. No new visual world, tokens or raster assets. Desktop and mobile must preserve readable solid surfaces, reachable actions and each runtime's truthful labels.

## Shared boundary

- Shared response views receive `Message` data and an explicit handoff slot. They do not import account stores, conversation persistence or sample fixtures.
- Runtime controllers select prototype/live behavior and pass state/actions to shared views. Services own API and persistence calls; backend authentication and permissions remain authoritative in live mode.
- Sample metadata is generated or migrated only by the prototype responder. Live messages preserve the API's segments, IDs, citations and optional blocks. Missing source/verdict data stays missing.
- Local entry chats and live entry chats retain separate storage keys. Server restoration, owner persistence, retry behavior and login continuation remain intact.
- Keep server agent settings, KB3 draft/publication state, real AI testing and room-agent assignment when applying the new navigation. Server success must precede a live saved-state claim; navigation retains pending edits.
- Hide only newly unsupported session-learning and contribution features in live mode. Existing live teaching and review operations remain available.

## Later stages

S2 must map room speakers explicitly to customer, expert and AI. The prototype room importer assumes two human roles and must not consume three-party rooms unchanged. Keep private transcript provenance separate from shared proposals. Agent settings use `expert_agents`; answer cases use existing KB3 draft and publication services. A saved configuration alone does not publish RAG knowledge.

S3 extends the existing approval system with a separate proposal, immutable submitted revisions, author/reviewer separation, review decisions and retraction. Publication and credit eligibility must be idempotent; retraction removes active retrieval eligibility and reverses credit without deleting history. The reviewed version, privacy/permission acknowledgments and concurrency rules need a backend contract before this UI is enabled. Reward amounts are outside this stage.

S4 reuses the visual system in three-party rooms while retaining real agent reply controls, room-agent selection and concurrency behavior.

## Verification contract

Use isolated prototype and live builds. The live UI tests intercept external APIs at the transport boundary; they do not call a paid model or modify production records. Verify source anchors, verdict/evidence data, optional-field absence, reload, guest/owner handoff and server persistence. Protect existing live studio operations and prototype navigation with behavioral tests. Record results and remaining limits before delivery.

## Verified delivery

Integration base: live `cba70608b013ba786dd885de68f830ec5dfec591` and prototype `e29538e` (including `f7b8fde` and `296e8cd`). The trial merge reproduced conflicts in 10 files; all are resolved. Backend, Supabase migrations, service implementations and three-party room files are unchanged relative to the live base.

- 83 unit tests pass. Live hydration keeps API metadata intact and never enriches missing fields with sample data.
- Both live and prototype production builds pass, including TypeScript. ESLint passes for every changed TypeScript/TSX file.
- Five live production browser tests pass using local HTTP interception: structured answers/reload, absent metadata, guest login continuation, owner-save failure/retry without an AI handoff, server agent settings and room assignment, manual-teaching save failure/recovery, case publication/shared-KB submission, real-preview transport, and live feature gates.
- Three prototype production browser tests pass: retained teaching drafts, Back/Forward knowledge navigation, separate shared proposals and reload persistence.
- Additional browser checks confirm all three sample block kinds, source metadata and reload behavior on desktop/mobile, with no external requests in prototype mode.
- Live light/dark answer and expert-picker captures plus live Studio and prototype answer captures were checked at 1440px and 390px. No horizontal overflow or page errors. The restored server checkboxes use bounded native controls and wrap onto a separate row on mobile.
- The design detector reported no findings. Finish review accepted the visual integration and requested one documentation correction: distinguish prototype simulation from live capabilities. PRODUCT.md and DESIGN.md now record that distinction; the reviewer scored the correction `ship`.

Captured UI uses synthetic transport fixtures. No paid model was called and no production record was changed. These checks do not validate deployed backend permissions, migration execution or model quality. S2, S3 and S4 remain open as specified above.
