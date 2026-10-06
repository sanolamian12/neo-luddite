# Agent practice workspace

Mode: Operate. Status: implemented browser-local prototype. Overview: `/audit/agents`; teaching, knowledge, contributions, principles and rehearsal have task URLs beneath it. Advanced route: `/audit/agents/advanced`. Direct participation lives in the consultation hub; shared proposals have a separate administrator review queue.

The first pass, approved iteration 2, and [consultation-learning and contribution extension](session-learning-contributions.md) are code-led extensions of the established luminous world. The existing technical canvas remains accessible on the advanced route. No new raster assets or global design tokens were introduced. The [iteration 2 direction contract](agent-customization-iteration-2.md), [policy contract](agent-policy-contract.md) and extension spec define the current scope.

THESIS: Experts teach an agent through cases, govern its knowledge and boundaries, and step into conversations from one approachable practice workspace.

OWN WORLD: Existing Pretendard, teal, mint, sky, paper editing surfaces, luminous navigation and light/dark tokens. Professional Korean language. Gentle depth and precise connecting lines supply the futuristic character.

STORY: Open a task directly, learn from a case or completed consultation, define the facts and conditions that govern an answer, test explicit observations, then take over a human request. Separately propose reusable knowledge and follow its review, publication and author credit record.

FIRST VIEWPORT: The shared expert sidebar, agent identity and save state, and the active task. The overview retains its teaching invitation and connected three-role diagram. Teaching offers session learning and manual case entry; contributions lead with a compact status summary and proposal list. Operating principles lead with a topic selector and structured criteria; rehearsal places explicit fact inputs alongside the conversation and evaluation evidence. No technical graph controls occupy the primary overview.

FORM: A routed task workspace with an asymmetric overview, source-and-lesson or sequential manual teaching workbench, searchable personal knowledge master/detail view, contribution ledger/detail view, editable criteria sheet, and rehearsal conversation with an evidence pane. The consultation hub contains participation review; administrators review shared proposals in their own queue. Small screens stack the same tasks and keep navigation reachable.

SIGNATURE: The expert's case becomes editable facts, judgment, conclusion, questions, and exceptions. In rehearsal, the expert changes actual client/document observations and sees the resulting missing facts, questions, comparisons, exceptions and answer source. Transitions use a short reveal with visible-by-default content and a reduced-motion fallback.

FINISH: Domain tests, production build, focused lint, desktop/mobile browser evidence, independent finish review, and documented prototype limitations before main delivery.

## Implemented surface

The sidebar, local task navigation and overview shortcuts use the same destinations. Each agent destination carries `?agent=<id>`; the overview is also available through `/audit/agents/overview`.

| Task | Destination |
| --- | --- |
| 한눈에 보기 | `/audit/agents` |
| 가르치기 | `/audit/agents/teach` |
| 지식 모음 | `/audit/agents/knowledge` |
| 공통 지식 기여 | `/audit/agents/contributions`; `&contribution=<id>` opens a record |
| 운영 원칙 | `/audit/agents/principles` |
| 미리보기 | `/audit/agents/preview` |
| 고급 설정 | `/audit/agents/advanced` |
| 참여 요청 | `/audit/consultations?kind=participation&agent=<id>`; `&review=<id>` opens the conversation |

Administrators review submitted knowledge at `/admin/knowledge-contributions`. The expert ledger shows the current author's proposals across agents; `?agent=<id>` retains the originating workspace context. Personal case/question actions pass `&case=<id>` or `&question=<id>` to an explicit shared-draft creation step.

One library provider in the prototype audit shell owns the selected expert's agent drafts and per-agent rehearsal state. Route changes and browser history retain in-memory edits; explicit Save persists the whole agent library, including practice and advanced graph changes. Rehearsal inputs and counters survive navigation but reset on reload; saved participation threads remain. Unknown agent IDs show recovery. Copies receive independent IDs, and switching demo experts loads a separate library. These are browser-local behaviors, not production authorization.

The overview pairs a case-teaching invitation with three connected responsibilities, then shows personal cases and unresolved participation. Teaching defaults to 상담에서 배우기; 직접 사례 들려주기 retains the original four steps and editable facts, judgment, conclusion, exceptions and questions. Session learning accepts completed human chats, resolved participation examples, pasted/TXT/MD transcripts and a labeled sample after permission confirmation. It retains speaker-labeled source beside a copied draft, asks the expert to supply rationale and scope, and requires manual review of a contrasting scenario and expected response. Reusable application updates one personal case and its questions; session-only material remains a private note. The agent Save action persists the private source and lesson. No semantic extraction or model test occurs in this teaching flow.

Knowledge separates personal cases from questions, with sticky search/filter controls, six-item pagination, inclusion switches, and priority among matching cases. Each can seed a separate shared proposal. Shared sample knowledge is platform-managed and excluded from this editable list; an empty personal collection has its own teaching action. Previously edited samples migrate into personal knowledge without losing content or IDs and persist on Save. The source actually selected in rehearsal remains visible as personal or shared knowledge.

The contribution ledger stores separate de-identified drafts with applicability and supporting sources. The author confirms privacy and sharing permission before each submitted snapshot; editing a shared draft leaves personal knowledge unchanged. The administrator records a reason and evidence/privacy/duplicate/applicability checks before publication, can request revision or decline, and can retract a published entry. Submitted snapshots, reviewer checks and attributed history remain traceable. Acceptance creates one author publication-credit eligibility record, and retraction reverses it; submission alone creates no credit. Reward policy is future work, with no invented money, points, payouts or measured usage impact.

Contribution actions persist directly to a separate local ledger, independent of the agent Save action. Expected-version checks reject stale edits while retaining entered content and offering an explicit reload. The ledger is shared across local demo accounts; client role checks and author filtering are not production authorization. Published answer/correction cases form an ephemeral shared retrieval overlay with author and version attribution. Retracted entries leave the overlay. Question contributions remain reviewed records and are not automatically turned into executable rules or answer cases.

Operating principles now lead with enabled topic rules, keyword matching, named required/optional facts and questions, follow-up limits and scope, unknown-answer handling, selected same-field comparisons, and explicit exception conditions with hold/human actions. Fields and rules retain stable IDs. An expert-authored question can be copied into a rule as an independent field. Validation appears beside the rule; invalid matched criteria withhold an answer. Introduction, voice, free-text guidance and demo availability remain in a separate disclosure below the criteria.

Rehearsal distinguishes the common AI, expert selection, and the expert's AI. Keywords select a rule, while client and document inputs supply facts. Missing or unknown required facts remain unconfirmed; stopping follow-up does not complete them. The evidence region shows the actual source case and a readable evaluation trace. An eligible stored answer still requires sufficient facts. See the [policy contract](agent-policy-contract.md) for supported comparisons, precedence and attempt counting.

A separate human request carries observations, source, reason, trace and messages into the consultation hub. Taking over pauses AI responses; a labeled expert reply stays in the same thread, and returning to AI is explicit. The [advanced Studio](agent-studio.md) shares drafts and saving, but its graph execution remains a separate simulation. No live model, free-text fact extraction, semantic policy interpretation, client delivery or model training is connected.

## Responsive behavior

The task content has a 1360px maximum width, with 32px desktop gutters, 24px gutters at 1250px and below, and 16px at 700px and below. Identity, save, agent selection, and local task navigation sit above the scrolling content. At 1000px and below, a labeled native selector exposes overview, teaching, knowledge, contributions, principles, rehearsal and participation beside a visible participation shortcut and unresolved count. It pushes the same URLs as the sidebar; participation opens the hub. The advanced action remains accessible by its label when its text is hidden. Manual teaching, principles, rehearsal, and inbox regions stack at this breakpoint. The shared sidebar becomes a mobile drawer.

At 800px and below, session source/editor and contribution layouts stack. Source turns occupy a bounded 350px scrolling region. The expert ledger and administrator queue switch between list and detail with a visible return action; selecting a record brings its detail into view and focuses it. Local paper sheets reduce their padding to 20px. These breakpoints and layouts belong to the extension, not the global token system.

At 700px and below, knowledge switches between list and detail with a visible return action; selecting a record scrolls and focuses its editor into view. Paired rule and observation fields also stack. The criteria sheet uses 24px inner padding, reduced to 16px at 800px and below. Task navigation focuses the active heading, and opening a participation record brings its detail into view on mobile. The short guidance reveal leaves content visible by default; reduced motion removes animation and transitions.

## Implementation and evidence

The [workspace component](../frontend/components/audit/agents/agent-practice.tsx), its [local styles](../frontend/components/audit/agents/agent-practice.module.css), and the teaching, knowledge, rules, rehearsal, and shared UI components in the same directory implement the surface. [Agent navigation](../frontend/lib/agent-navigation.ts) defines task URLs; the [library provider](../frontend/components/audit/agents/agent-library.tsx) owns shared private drafts. [Practice domain functions](../frontend/lib/agent-practice.ts) own teaching, retrieval, migration and human-control transitions; [policy evaluation](../frontend/lib/agent-policy.ts) and [rehearsal](../frontend/lib/agent-rehearsal.ts) apply structured observations. The [extension spec](session-learning-contributions.md) maps session learning, ledger/detail, review queue, domain transitions and shared retrieval sources, and supplies the backend handoff.

Existing luminous palette, theme pairs, shadows, radii, Pretendard, and Lucide icons are reused. Local heading sizes, fieldset corners, control dimensions, and responsive composition are surface decisions; no new global tokens or raster assets were introduced. `DESIGN.md` and `.impeccable/design.json` remain unchanged. See the [contribution extension verification](session-learning-contributions-verification.md) for the current desktop/mobile/dark evidence and independent SHIP disposition, and [iteration 2 verification](agent-customization-iteration-2-verification.md) for the policy workspace; the [first-pass record](agent-customization-verification.md) remains historical evidence. Production consent/retention, authenticated ownership/review, immutable server history, atomic version checks, idempotent publication credit, KB/vector ingestion and approved rewards remain backend work.
