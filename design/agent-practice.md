# Agent practice workspace

Mode: Operate. Overview: `/audit/agents`; teaching, knowledge, principles and rehearsal have task URLs beneath it. Advanced route: `/audit/agents/advanced`. Direct participation lives in the consultation hub.

The first pass and approved iteration 2 are code-led extensions of the established luminous world. The existing technical canvas remains accessible on the advanced route. No new raster assets or global design tokens were introduced. The [iteration 2 direction contract](agent-customization-iteration-2.md) and [policy contract](agent-policy-contract.md) define the current scope.

THESIS: Experts teach an agent through cases, govern its knowledge and boundaries, and step into conversations from one approachable practice workspace.

OWN WORLD: Existing Pretendard, teal, mint, sky, paper editing surfaces, luminous navigation and light/dark tokens. Professional Korean language. Gentle depth and precise connecting lines supply the futuristic character.

STORY: Open a task directly, teach personal knowledge, define the facts and conditions that govern an answer, test explicit observations, then take over a human request.

FIRST VIEWPORT: The shared expert sidebar, agent identity and save state, and the active task. The overview retains its teaching invitation and connected three-role diagram. Operating principles lead with a topic selector and structured criteria; rehearsal places explicit fact inputs alongside the conversation and evaluation evidence. No technical graph controls occupy the primary overview.

FORM: A routed task workspace with an asymmetric overview, sequential teaching workbench, searchable personal knowledge master/detail view, editable criteria sheet, and rehearsal conversation with an evidence pane. The consultation hub contains participation review. Small screens stack the same tasks and keep navigation reachable.

SIGNATURE: The expert's case becomes editable facts, judgment, conclusion, questions, and exceptions. In rehearsal, the expert changes actual client/document observations and sees the resulting missing facts, questions, comparisons, exceptions and answer source. Transitions use a short reveal with visible-by-default content and a reduced-motion fallback.

FINISH: Domain tests, production build, focused lint, desktop/mobile browser evidence, independent finish review, and documented prototype limitations before main delivery.

## Implemented surface

The sidebar, local task navigation and overview shortcuts use the same destinations. Each agent destination carries `?agent=<id>`; the overview is also available through `/audit/agents/overview`.

| Task | Destination |
| --- | --- |
| 한눈에 보기 | `/audit/agents` |
| 가르치기 | `/audit/agents/teach` |
| 지식 모음 | `/audit/agents/knowledge` |
| 운영 원칙 | `/audit/agents/principles` |
| 미리보기 | `/audit/agents/preview` |
| 고급 설정 | `/audit/agents/advanced` |
| 참여 요청 | `/audit/consultations?kind=participation&agent=<id>`; `&review=<id>` opens the conversation |

One library provider in the prototype audit shell owns the selected expert's agent drafts and per-agent rehearsal state. Route changes and browser history retain in-memory edits; explicit Save persists the whole agent library, including practice and advanced graph changes. Rehearsal inputs and counters survive navigation but reset on reload; saved participation threads remain. Unknown agent IDs show recovery. Copies receive independent IDs, and switching demo experts loads a separate library. These are browser-local behaviors, not production authorization.

The overview pairs a case-teaching invitation with three connected responsibilities, then shows personal cases and unresolved participation. Teaching has four steps and keeps the expert's facts, judgment, conclusion, exceptions, and questions editable before explicit application. Knowledge separates personal cases from questions, with sticky search/filter controls, six-item pagination, inclusion switches, and priority among matching cases. Shared sample knowledge is platform-managed and excluded from this editable list; an empty personal collection has its own teaching action. Previously edited samples migrate into personal knowledge without losing content or IDs and persist on Save. The source actually selected in rehearsal remains visible as personal or shared knowledge.

Operating principles now lead with enabled topic rules, keyword matching, named required/optional facts and questions, follow-up limits and scope, unknown-answer handling, selected same-field comparisons, and explicit exception conditions with hold/human actions. Fields and rules retain stable IDs. An expert-authored question can be copied into a rule as an independent field. Validation appears beside the rule; invalid matched criteria withhold an answer. Introduction, voice, free-text guidance and demo availability remain in a separate disclosure below the criteria.

Rehearsal distinguishes the common AI, expert selection, and the expert's AI. Keywords select a rule, while client and document inputs supply facts. Missing or unknown required facts remain unconfirmed; stopping follow-up does not complete them. The evidence region shows the actual source case and a readable evaluation trace. An eligible stored answer still requires sufficient facts. See the [policy contract](agent-policy-contract.md) for supported comparisons, precedence and attempt counting.

A separate human request carries observations, source, reason, trace and messages into the consultation hub. Taking over pauses AI responses; a labeled expert reply stays in the same thread, and returning to AI is explicit. The [advanced Studio](agent-studio.md) shares drafts and saving, but its graph execution remains a separate simulation. No live model, free-text fact extraction, semantic policy interpretation, client delivery or model training is connected.

## Responsive behavior

The task content has a 1360px maximum width, with 32px desktop gutters, 24px gutters at 1250px and below, and 16px at 700px and below. Identity, save, agent selection, and local task navigation sit above the scrolling content. At 1000px and below, a labeled native selector exposes overview, teaching, knowledge, principles, rehearsal and participation beside a visible participation shortcut and unresolved count. It pushes the same URLs as the sidebar; participation opens the hub. The advanced action remains accessible by its label when its text is hidden. Teaching, principles, rehearsal, and inbox regions stack at this breakpoint. The shared sidebar becomes a mobile drawer.

At 700px and below, knowledge switches between list and detail with a visible return action; selecting a record scrolls and focuses its editor into view. Paired rule and observation fields also stack. The criteria sheet uses 24px inner padding, reduced to 16px at 800px and below. Task navigation focuses the active heading, and opening a participation record brings its detail into view on mobile. The short guidance reveal leaves content visible by default; reduced motion removes animation and transitions.

## Implementation and evidence

The [workspace component](../frontend/components/audit/agents/agent-practice.tsx), its [local styles](../frontend/components/audit/agents/agent-practice.module.css), and the teaching, knowledge, rules, rehearsal, and shared UI components in the same directory implement the surface. [Agent navigation](../frontend/lib/agent-navigation.ts) defines task URLs; the [library provider](../frontend/components/audit/agents/agent-library.tsx) owns shared drafts. [Practice domain functions](../frontend/lib/agent-practice.ts) own teaching, retrieval, migration and human-control transitions; [policy evaluation](../frontend/lib/agent-policy.ts) and [rehearsal](../frontend/lib/agent-rehearsal.ts) apply structured observations.

Existing luminous palette, theme pairs, shadows, radii, Pretendard, and Lucide icons are reused. Local heading sizes, fieldset corners, control dimensions, and responsive composition are surface decisions; no new global tokens or raster assets were introduced. `DESIGN.md` and `.impeccable/design.json` remain unchanged. See [iteration 2 verification](agent-customization-iteration-2-verification.md) for current behavior, token comparison, review scope and limitations; the [first-pass record](agent-customization-verification.md) remains historical evidence.
