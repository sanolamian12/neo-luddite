# Luminous expert workspace

Mode: Operate. In the prototype, adopt the approved luminous system in `/audit/dashboard`, the `/audit/agents` task family, `/audit/consultations` and their shared navigation. Other audit routes retain their existing theme. The primary agent surface is the [practice workspace](agent-practice.md); the preserved [Studio canvas](agent-studio.md) lives on the advanced route.

THESIS: A calm, light-filled workspace makes consultation requests, conversations needing human judgment and agent settings easy to reach.

OWN-WORLD: Pretendard, deep teal text, mist canvas, translucent navigation, mint contribution surfaces and sky accents. Use the existing luminous tokens and components. Keep controls solid and readable in both themes.

STORY: Review the local consultation queues, open the requested conversation, or teach and oversee an agent. Advanced settings retain stage editing, testing, and saving.

FIRST VIEWPORT: The dashboard leads with a direct consultation heading, three actionable queue rows and the selected agent summary. Unresolved participation conversations follow with explicit waiting or human-owned status. The primary agent workspace opens the selected task. Advanced Studio retains its workflow, inspector and test arrangement.

FORM: Code-led extension of the approved specimen; no new identity or illustrative assets. The dashboard explicitly labels browser-local example consultations and avoids invented performance metrics. Empty queues explain the available next step. Mobile navigation and account portals inherit the active theme. The audit layout retains theme selection during client navigation and applies it only to the adopted routes; browser reload starts in light mode.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

Validation covers desktop/mobile, both themes, empty/populated data, navigation, account editing, workflow selection, saved configurations and simulation traces. No raster assets ship.

## Implementation

- The prototype [dashboard](../frontend/components/audit/agents/expert-dashboard.tsx) uses account-filtered consultation data and the shared agent library. Queue rows show pending new applications, waiting direct-participation requests and accepted consultations. Accepted means ongoing in this prototype; appointments are not connected. The participation count and its destination use the same waiting set, including agent and conversation IDs. The lower list shows up to five unresolved conversations, with waiting and direct-participation states distinguished.
- Dashboard content uses 36px gutters and a 1.35:1 queue/agent layout with a 40px gap. At 800px and below it stacks with 20px horizontal gutters and a 24px gap. The agent summary uses existing glass, panel-radius and shadow tokens; queue rows use dividers and explicit counts. The heading stands on its own without a decorative eyebrow.
- The prototype [expert sidebar](../frontend/components/layout/expert-sidebar.tsx) groups workspace, agent and consultation tasks. Agent links preserve the selected ID. The public pool is labeled 공개 상담 사례; customer messages stay in chat and system/admin messages in the mailbox. Legacy evaluation URLs remain accessible outside everyday navigation.
- The [consultation hub](../frontend/components/audit/agents/consultation-hub.tsx) separates 새 상담 신청 (`kind=new`) from 직접 참여 요청 (`kind=participation`). Existing `/audit/consultations/<id>` links open new-application details. Participation adds an agent selector, optional `review` ID, context and same-thread takeover/reply/return controls. Its badge counts unresolved participation, including conversations already held by the expert; the dashboard waiting row counts only waiting requests. Agent changes clear the selected conversation. Saving the request inbox persists the shared library.
- Studio retains the canvas, inspector, and test topology. Nodes are 230px by 176px with 266px graph-column spacing; the inspector is 320px, or 300px at widths up to 1200px. Explicit flow/settings/test views apply at 900px and below. Native controls use luminous tokens and 40px minimum-height primary action groups and selects.
- The [audit shell](../frontend/components/layout/audit-shell.tsx) owns one prototype agent library across dashboard, agent tasks and consultations. Draft edits survive route changes; practice and advanced Save share that library. Scoped aliases extend the existing palette to cards, popovers, accent states, and sidebar primitives. Optional theme context reaches drawer and account-menu portal roots. Reduced motion covers the luminous roots, descendants, and separate drawer backdrop.

## Iteration 2 evidence

The [iteration 2 verification record](agent-customization-iteration-2-verification.md) covers task URLs, shared state, the consultation dashboard/hub and structured criteria. Its independent finish disposition is `ship` for the two scored dashboard corrections only: waiting-request routing and removal of the heading eyebrow. The refreshed dashboard captures contain a temporary two-agent browser fixture; the fixture is verification data and does not represent live customers. This disposition is not a new approval of every retained workspace surface.

## Verification (2026-10-01)

The following records the earlier contribution dashboard/Studio luminous adoption, before iteration 2 replaced the prototype dashboard. First-pass primary-workspace verification is recorded separately in [agent-customization-verification.md](agent-customization-verification.md).

- Existing frontend suite: 20 tests passed before the review correction. Changed-file ESLint, TypeScript and production build passed again after the reduced-motion correction.
- Chromium production checks: no document overflow at 320, 390, 768, 1024 and 1440px; light/dark desktop and mobile captures; mobile navigation closes after selection; both portal surfaces inherit the active theme; navigation between adopted routes preserves theme, and other routes do not inherit it.
- Studio: edited instructions survive reload, simulation completes with the expected sample handoff, disconnected stages disable execution and explain recovery, and trace inspection moves focus to the visible record on desktop and mobile.
- Dashboard: two temporary browser-only ledger fixtures produce 240 cr and 83% (5 of 6 accepted), draft work exposes its continuation link, and the empty scenario shows an unmeasured rate and a first-task action. These fixtures are verification data, not bundled product records.
- Design detector: no findings. All 11 production captures were refreshed after the review correction under `.impeccable/review/workspace-*.png` and `output/playwright/workspace-*.png`; no raster assets ship.
- Independent finish review validated visual fidelity across all 11 production captures and requested one correction for reduced-motion portal roots and backdrop. The correction is applied; production browser checks confirm no drawer/backdrop transition and no account-menu animation with reduced motion requested. The final verdict returned `ship` for that scored fix, confirmed all 11 refreshed captures valid with no visible regression, and listed no remaining issues; the original full review otherwise passed visual fidelity.
- Documentation now records the adoption scope while preserving the 49 existing color entries and component previews. Screen-reader speech and mobile Safari have not been tested.
