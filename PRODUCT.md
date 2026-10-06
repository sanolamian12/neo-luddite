# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Experts who want to teach, govern, and oversee their own AI service, and engage directly with clients at critical moments.

## Product Purpose

Prototype an approachable, visual workspace for transferring expert know-how through cases, shaping question and answer knowledge, setting boundaries, rehearsing conversations, and taking over when human engagement is needed.

Experts also improve the shared service together. Completed human consultations and text transcripts can become reviewed personal lessons; experts separately propose reusable, de-identified knowledge to the common KB. Authorship, submitted revisions, review decisions, published versions and credit eligibility remain traceable. Reward policy and monetary settlement are not yet defined.

## Operating Context

The frontend supports two runtimes. Prototype mode is the default for independent exploration; live mode connects to the existing backend and Supabase services. Both use the same Korean workspace and Luminous presentation. Guided manual teaching is available in both modes; advanced workflow editing, consultation extraction and the separate contribution ledger remain prototype-only. See `design/agent-customization-prd.md`, `design/agent-customization-flows.md` and `design/live-prototype-integration.md` for scope and integration boundaries.

## Capabilities and Constraints

- Named reusable configurations with editable question and answer collections, case teaching, operating principles, rehearsals, and a simulated human review inbox.
- Advanced stages, instructions, connections, and conditional routing remain available separately in prototype mode.
- Confidence indicators in this prototype are explicitly illustrative, distinct from fact completeness.
- Prototype execution is simulated, with no LLM calls or model training. Browser storage provides demo persistence per expert identity, not a production privacy boundary.
- Live entry chat renders API-provided response segments, sources, verdicts, evidence and optional expert handoff. It never fills missing metadata with sample content. Owner conversations persist through the existing service.
- Live Studio saves agent settings and room-agent selection to the server. Reviewed manual lessons become KB3 drafts; explicit publication enables retrieval for connected consultations, and the existing shared-KB approval flow controls broader sharing. Saving settings alone does not publish cases.
- Live Studio retains the real AI preview endpoint alongside the clearly labeled local rehearsal. Neither runtime trains a model through this UI.
- Prototype consultation learning organizes speaker-labeled excerpts and requires the expert's rationale, scope and a manually reviewed variation. It does not infer unspoken reasoning or transcribe audio.
- A prototype-only local contribution ledger and administrator review queue demonstrate submission, revision, publication, retraction and author credit eligibility. Published answer cases can be retrieved across experts in local rehearsals; raw session transcripts are excluded from contribution payloads.
- Session learning (S2) and the richer proposal/revision/retraction ledger (S3) remain hidden in live mode pending backend contracts. Existing live KB3 publication and approval remain available. Three-party room restyling (S4) is separate; its current server behavior is preserved.

## Evidence on Hand

Existing Korean-language expert workspace, local demo accounts, synthetic conversation data and live service contracts. Integration browser tests exercise production frontend builds with intercepted transport fixtures; they do not establish backend authorization, database migration correctness or model quality. No measured model accuracy or confidence data.
