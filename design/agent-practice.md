# Agent practice workspace

Mode: Operate. Route: `/audit/agents`. Advanced route: `/audit/agents/advanced`.

The user delegated the first pass and asked for review after delivery on main. This is a code-led extension of the established luminous world. The existing technical canvas remains accessible on the advanced route. No new raster assets or global design tokens are required.

THESIS: Experts teach an agent through cases, govern its knowledge and boundaries, and step into conversations from one approachable practice workspace.

OWN WORLD: Existing Pretendard, teal, mint, sky, paper editing surfaces, luminous navigation and light/dark tokens. Professional Korean language. Gentle depth and precise connecting lines supply the futuristic character.

STORY: Orient through the three responsibilities, teach a case, review editable guidance, apply it to the knowledge collection, test a variation, then take over a human request.

FIRST VIEWPORT: Agent identity and save state; a restrained horizontal task navigation; a generous teaching invitation beside a connected three-role diagram; below, a readable knowledge list and attention queue. No technical graph controls occupy the primary overview.

FORM: A task workspace with an asymmetric overview, sequential teaching workbench, searchable knowledge master/detail view, readable principles form, rehearsal conversation with an evidence pane, and review inbox. Small screens use one column and keep navigation reachable.

SIGNATURE: The expert's case becomes editable facts, judgment, conclusion, questions, and exceptions, then the selected rehearsal highlights their source and whether human judgment is needed. Transitions use a short reveal with visible-by-default content and a reduced-motion fallback.

FINISH: Domain tests, production build, focused lint, desktop/mobile browser evidence, independent finish review, and documented prototype limitations before main delivery.

## Implemented surface

`/audit/agents` is the primary workspace, with six tasks: 한눈에 보기, 가르치기, 지식 모음, 운영 원칙, 미리보기, and 참여 요청. The [advanced Studio](agent-studio.md) retains its graph at `/audit/agents/advanced`. Both routes use the existing per-expert agent library; practice data is an optional extension to each saved agent, and advanced graph execution remains a separate simulation.

The overview pairs a case-teaching invitation with three connected responsibilities, then shows recent cases and pending participation. Teaching has four steps and keeps the expert's facts, judgment, conclusion, exceptions, and questions editable before explicit application. The knowledge view separates cases from questions, with sticky search/filter controls, six-item pagination, inclusion switches, and priority among matching cases. Principles record the service introduction, voice, boundaries, participation triggers, and demo availability.

Rehearsal distinguishes the common AI, expert selection, and the expert's AI. A separate human request carries context into the inbox. Taking over pauses AI responses; a labeled expert reply stays in the same thread, and returning to AI is explicit. Teaching organizes supplied fields, and rehearsal uses literal keyword matches and selected scenarios. No live model, semantic policy interpretation, client delivery, or model training is connected.

## Responsive behavior

The task content has a 1360px maximum width, with 32px desktop gutters, 24px gutters at 1250px and below, and 16px at 700px and below. Identity, save, agent selection, and task navigation sit above the scrolling content. At 1000px and below, a labeled native selector exposes all six tasks beside a visible participation-request shortcut and its pending count. The advanced action remains accessible by its label when its text is hidden. Teaching, principles, rehearsal, and inbox regions stack at this breakpoint.

At 700px and below, knowledge switches between list and detail with a visible return action; selecting a record scrolls and focuses its editor into view. Task navigation focuses the active heading. The short guidance reveal leaves content visible by default; reduced motion removes animation and transitions.

## Implementation and evidence

The [workspace component](../frontend/components/audit/agents/agent-practice.tsx), its [local styles](../frontend/components/audit/agents/agent-practice.module.css), and the teaching, knowledge, rehearsal, and shared UI components in the same directory implement the surface. [Practice domain functions](../frontend/lib/agent-practice.ts) own validation, application, retrieval, and human-control transitions.

Existing luminous palette, theme pairs, shadows, radii, Pretendard, and Lucide icons are reused. Local heading sizes, control dimensions, and responsive composition are surface decisions; no new global tokens or raster assets were introduced. `DESIGN.md` and `.impeccable/design.json` remain unchanged. See the [verification record](agent-customization-verification.md) for tested behavior, review scope, artifacts, and limitations.
