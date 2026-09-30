# Agent studio prototype

Mode: Operate. Route: `/audit/agents` in the prototype fork only.

Approved direction: workflow canvas in the center, selected stage instructions on the right, test conversation alongside the workflow. Inherit the existing Pretendard typography, green expert navigation, restrained borders and white working surfaces. Build directly in code from the approved layout; no new visual identity or raster assets.

## First viewport

The named agent and explicit save action sit above a visible three-stage flow. Selecting a stage immediately exposes its editable instructions. Connection arrows carry data and conditions. A persistent simulation label distinguishes demo confidence and sample answers from measured model outputs.

## Signature interaction

Run a scenario to watch the configured stages activate in graph order; select any completed stage to inspect the exact inputs, instruction snapshot, and output. Change connections or handoff conditions and run again to see different paths and recommendations.

## Responsive behavior

Desktop: canvas and test panel beside a fixed-width inspector. Mobile: flow, settings and testing views are switched explicitly; selecting a stage opens its settings. Keep graph panning within the canvas and all forms within the viewport.

## Scope and boundaries

Add/remove stages, add/remove conditional connections with typed payloads, edit names/instructions/source notes/model presets, save/reopen multiple configurations by demo expert, and test deterministic scenarios. Invalid cycles, orphan stages and missing inputs produce actionable messages. Prompts and source notes are recorded in the trace but not interpreted; model presets do not contact providers. No client publishing or production access control.

## Direction contract

THESIS: Experts understand and edit the flow that creates their answer, with the instruction editor one selection away.

OWN-WORLD: Inherit the existing green expert sidebar, Pretendard text, white form surfaces, thin neutral borders and Lucide icons. Green indicates selection and execution; amber marks a recommendation to consult a person.

STORY: Select a stage, change its instructions or connections, test the flow, and save a named agent.

FIRST VIEWPORT: Agent selector and save action above a horizontal workflow; a 330px settings column on the right; scenario and test question below the canvas. Mobile separates these three tasks into explicit views.

FORM: User-approved canvas, inspector and test panel. No concept seed: the user approved this precise arrangement in conversation.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Implementation record

- The existing identity and the Studio-specific values are recorded in root `DESIGN.md` and `.impeccable/design.json`.
- Completed-stage trace actions open the corresponding record and move focus to its summary. Records expose the full routed input payload alongside outputs, instruction snapshots and source notes.
- Configuration issues appear in the test view as well as the workflow, with links to the relevant mobile task views.
- Review evidence is stored under `output/playwright/agent-studio-{desktop,desktop-run,mobile,mobile-settings,mobile-run,mobile-validation}.png`. These screenshots are verification artifacts; no raster assets ship with the surface.
- Production ownership, hosting, publishing, client sharing and private access remain undecided. Browser-local expert configurations provide demo persistence only.
