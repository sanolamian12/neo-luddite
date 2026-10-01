# Luminous expert workspace

Mode: Operate. Adopt the approved luminous system in `/audit/dashboard`, `/audit/agents` and their shared navigation. Other audit routes retain their existing theme.

THESIS: A calm, light-filled workspace gives experts a clear view of their contribution and room to shape their agent.

OWN-WORLD: Pretendard, deep teal text, mist canvas, translucent navigation, mint contribution surfaces and sky accents. Use the existing luminous tokens and components. Keep controls solid and readable in both themes.

STORY: Review real activity and contribution, continue an evaluation, or open an agent, edit a stage, test and save.

FIRST VIEWPORT: The dashboard leads with the expert's contribution and clear next actions. Studio retains its workflow, inspector and test arrangement with more breathing room and readable metadata.

FORM: Code-led adoption of the approved specimen; no new identity, illustrative assets or synthetic dashboard data. Empty metrics explain that results have not been recorded. Mobile navigation and account portals inherit the active theme. The audit layout retains theme selection during client navigation and applies it only to the adopted routes; browser reload starts in light mode.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

Validation covers desktop/mobile, both themes, empty/populated data, navigation, account editing, workflow selection, saved configurations and simulation traces. No raster assets ship.

## Implementation

- Dashboard uses `MetricCard`, `Surface`, `StatusBadge`, and `LuminousButton` with account-filtered store data. With no accepted or rejected results, the rate is an unmeasured dash rather than 0%. Its 1360px maximum content area uses 32px desktop gutters; action cards become two columns at 1100px, and summaries stack with 16px gutters at 640px.
- Studio retains the canvas, inspector, and test topology. Nodes are 230px by 176px with 266px graph-column spacing; the inspector is 320px, or 300px at widths up to 1200px. Explicit flow/settings/test views apply at 900px and below. Native controls use luminous tokens and 40px minimum-height primary action groups and selects.
- Scoped aliases extend the existing palette to cards, popovers, accent states, and sidebar primitives. Optional theme context reaches drawer and account-menu portal roots without changing other routes. Reduced motion covers the luminous roots, descendants, and separate drawer backdrop.

## Verification (2026-10-01)

- Existing frontend suite: 20 tests passed before the review correction. Changed-file ESLint, TypeScript and production build passed again after the reduced-motion correction.
- Chromium production checks: no document overflow at 320, 390, 768, 1024 and 1440px; light/dark desktop and mobile captures; mobile navigation closes after selection; both portal surfaces inherit the active theme; navigation between adopted routes preserves theme, and other routes do not inherit it.
- Studio: edited instructions survive reload, simulation completes with the expected sample handoff, disconnected stages disable execution and explain recovery, and trace inspection moves focus to the visible record on desktop and mobile.
- Dashboard: two temporary browser-only ledger fixtures produce 240 cr and 83% (5 of 6 accepted), draft work exposes its continuation link, and the empty scenario shows an unmeasured rate and a first-task action. These fixtures are verification data, not bundled product records.
- Design detector: no findings. All 11 production captures were refreshed after the review correction under `.impeccable/review/workspace-*.png` and `output/playwright/workspace-*.png`; no raster assets ship.
- Independent finish review validated visual fidelity across all 11 production captures and requested one correction for reduced-motion portal roots and backdrop. The correction is applied; production browser checks confirm no drawer/backdrop transition and no account-menu animation with reduced motion requested. The final verdict returned `ship` for that scored fix, confirmed all 11 refreshed captures valid with no visible regression, and listed no remaining issues; the original full review otherwise passed visual fidelity.
- Documentation now records the adoption scope while preserving the 49 existing color entries and component previews. Screen-reader speech and mobile Safari have not been tested.
