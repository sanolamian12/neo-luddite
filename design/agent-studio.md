# Agent studio prototype

Mode: Operate. Route: `/audit/agents/advanced` in the prototype fork only. The primary `/audit/agents` route is the [case-teaching and oversight workspace](agent-practice.md).

Approved direction: workflow canvas in the center, selected stage instructions on the right, test conversation alongside the workflow. The 2026-10-01 adoption applies the approved luminous system: Pretendard, translucent expert navigation, teal actions, and near-opaque editing surfaces in light and dark themes. Preserve the approved layout; no new visual identity or raster assets.

## First viewport

The named agent and explicit save action sit above a visible three-stage flow. Selecting a stage immediately exposes its editable instructions. Connection arrows carry data and conditions. A persistent simulation label distinguishes demo confidence and sample answers from measured model outputs.

## Signature interaction

Run a scenario to watch the configured stages activate in graph order; select any completed stage to inspect the exact inputs, instruction snapshot, and output. Change connections or handoff conditions and run again to see different paths and recommendations.

## Responsive behavior

Desktop: canvas and test panel beside a 320px inspector, reduced to 300px at widths up to 1200px. At 900px and below, flow, settings and testing views are switched explicitly; selecting a stage opens its settings. Nodes are 230px by 176px with 266px between graph columns. Keep graph panning within the canvas and all forms within the viewport.

## Scope and boundaries

Add/remove stages, add/remove conditional connections with typed payloads, edit names/instructions/source notes/model presets, save/reopen multiple configurations by demo expert, and test deterministic scenarios. Invalid cycles, orphan stages and missing inputs produce actionable messages. Prompts and source notes are recorded in the trace but not interpreted; model presets do not contact providers. No client publishing or production access control.

## Direction contract

THESIS: Experts understand and edit the flow that creates their answer, with the instruction editor one selection away.

OWN-WORLD: Adopt the approved luminous tokens, Pretendard text, translucent expert sidebar, near-opaque form surfaces, stronger field boundaries, and Lucide icons. Teal emphasizes selection and execution; semantic status pairs retain explicit labels. Decorative mint, sky, and amber tones do not define status.

STORY: Select a stage, change its instructions or connections, test the flow, and save a named agent.

FIRST VIEWPORT: Agent selector and save action above a horizontal workflow; a 320px settings column on the right; scenario and test question below the canvas. Mobile separates these three tasks into explicit views.

FORM: User-approved canvas, inspector and test panel. No concept seed: the user approved this precise arrangement in conversation.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Implementation record

- Root `DESIGN.md` and `.impeccable/design.json` retain the approved luminous tokens and previews. Studio dimensions and interaction structure are recorded here; native controls use luminous tokens, with 40px minimum-height primary action groups and selects.
- The [expert workspace brief](expert-workspace.md) records the shared dashboard/Studio adoption and current verification. The audit layout retains theme selection across client navigation; reload starts in light mode. Drawer and account-menu portals receive the active theme and reduced-motion treatment.
- Completed-stage trace actions open the corresponding record and move focus to its summary. Records expose the full routed input payload alongside outputs, instruction snapshots and source notes.
- Configuration issues appear in the test view as well as the workflow, with links to the relevant mobile task views.
- Original Studio review evidence is stored under `output/playwright/agent-studio-{desktop,desktop-run,mobile,mobile-settings,mobile-run,mobile-validation}.png`. Current luminous adoption captures are under `.impeccable/review/workspace-*.png` and `output/playwright/workspace-*.png`. These screenshots are verification artifacts; no raster assets ship with the surface.
- Production ownership, hosting, publishing, client sharing and private access remain undecided. Browser-local expert configurations provide demo persistence only.
- Studio and the primary workspace share the existing per-expert agent library. Optional practice data preserves the legacy stages and connections; the advanced graph simulation runs separately from the primary workspace's knowledge rehearsal. The current route and practice verification are recorded in [agent-customization-verification.md](agent-customization-verification.md).
