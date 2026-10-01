# Expert workspace and executable policy settings

Approved follow-up, 2026-10-01. Preserve the luminous visual system and the existing frontend prototype boundary.

## Delivery sequence

1. Give each agent task a URL and preserve the selected agent, drafts, back/forward navigation, and direct links. Reorganize the expert sidebar into workspace, agent, and consultation groups. Keep legacy evaluation routes accessible without placing them in everyday navigation.
2. Make the dashboard about consultation requests, ongoing consultations, human participation, and agent state. Group new consultation and AI participation requests under one destination with explicit request types. Rename the case pool to match its contents. Keep customer conversations in chat; system mail stays in the mailbox. Peer messaging needs a separate backend contract and is not invented here.
3. Show expert-authored knowledge by default. Treat shared sample knowledge as platform-managed, while exposing the source actually used in rehearsal. Preserve previously edited sample content through migration into personal knowledge.
4. Add structured rule settings: topic keywords, named required facts, follow-up limits and scope, unknown-answer behavior, same-field source comparison, explicit exception conditions, and subsequent action. Persist stable rule and field IDs. Validate rules before use.
5. Run those rules against editable structured facts in rehearsal. Keywords select the policy; they do not establish facts. Unknown answers stay unknown. Stop asking at the configured limit and show the chosen fallback. Do not claim that free text is extracted by a live model.
6. Test migration, policy evaluation, routing and account isolation; inspect desktop/mobile browser flows; complete independent design review and documentation; push main; email the engineer the concrete result.

## Contract

The backend integration seam is a versioned JSON policy and an explicit evaluation input/output. A rule interpreter applies supported settings; creating a new operation still requires development. The local rehearsal evaluates actual structured inputs rather than pretending that changing a scenario label evaluates a conversation. Shared RAG ingestion, live semantic extraction, publication, and client delivery remain backend work.


## Direction contract

THESIS: The expert can see and change what counts as sufficient evidence and immediately test its consequence.

OWN WORLD: Inherit Pretendard, luminous teal/mint/sky surfaces, native controls, and existing light/dark tokens. No new visual identity or artwork.

STORY: Open a task directly, teach personal knowledge, define a checkable rule, change facts in rehearsal, and see the reason for the resulting answer or human request.

FIRST VIEWPORT: A concise expert sidebar, agent identity and save state, and the active task. Rules expose a topic selector and an editable policy sheet; rehearsal pairs fact inputs with an evaluation trace. The dashboard leads with actionable consultation queues and the active agent.

FORM: Extend the approved workspace directly. Mobile stacks the same tasks; task URLs and explicit source/status labels carry wayfinding.

FINISH: Behavior tests, production build, browser evidence, independent finish review, and implementation documentation precede main delivery and the Gmail response.

## Delivery record

The routed workspace, shared draft library, consultation dashboard and request hub, personal/shared knowledge separation, policy editor and deterministic rehearsal are implemented. Browser checks verify route history, reload, cross-editor persistence, human control, missing facts, unknowns, exceptions and account isolation. The policy contract records both supported behavior and the remaining backend boundary.

Independent review requested two dashboard corrections: remove the heading eyebrow and align the waiting count's destination with an actual waiting conversation. The original misrouting was reproduced with one agent already participating and a second agent waiting; the fix uses the same waiting set for both count and destination and includes the conversation ID. See the [iteration verification record](agent-customization-iteration-2-verification.md) for final evidence and review disposition.
