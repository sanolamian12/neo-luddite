# Agent customization PRD

Updated for iteration 2, 2026-10-01. See [delivery plan](agent-customization-iteration-2.md) and [policy integration contract](agent-policy-contract.md). Source: [agreed vision](agent-customization-vision.md). The user delegated first-pass product and interface decisions and authorized delivery on main. The decisions below are implementation choices for review, not previously stated user requirements.

## Purpose

Help experts express their professional judgment in an AI service, inspect how that guidance affects a conversation, and participate personally when needed. Success is an expert completing a case teaching cycle and seeing that knowledge used in a rehearsal without needing to understand a model graph or RAG parameters.

## Audience and context

The primary user is a Korean-speaking professional using the existing expert workspace. They bring cases, questions, judgment, and exceptions. Clients first encounter the common model, then choose an expert's service, and can request direct human participation in the expert chat.

## First-pass decisions

| Topic | Decision |
| --- | --- |
| Two transitions | Selecting an expert starts their customized AI service. A separate request asks for direct human participation. Both identities remain explicit. |
| Agent roles | Present three responsibilities: understand facts, prepare an answer, recognize a need for human judgment. Preserve the existing configurable graph in advanced settings. |
| Customization | Agent name and introduction, response style, question collection, answer cases, inclusion and priority of cases, operating rules, exclusions, and human engagement conditions. |
| RAG controls | Experts edit knowledge and determine which cases participate or receive priority. The first pass uses visible keyword matching for rehearsal, not embeddings or model fine-tuning. A preferred case must still match the question. |
| Teaching | Describe a case, explain the judgment, review an editable case and questions, then test structured facts. Guidance only enters the knowledge collection through an explicit apply action. |
| Fact completeness | Named required facts, limited follow-up attempts, unknown handling, same-field source comparisons and explicit exception conditions are editable data. Rehearsal applies these criteria to manually supplied observations and withholds conclusions when necessary. |
| Human involvement | An explicit client request always requests a human. Experts configure the criteria and resulting hold/human action per topic. No illustrative confidence percentage decides this flow. |
| Human control | A request enters the inbox. The expert takes over, which pauses AI responses. The expert can reply in the same rehearsal thread and explicitly return it to AI. Unavailability leaves a clearly pending request. |
| Context | The rehearsal carries the client's question, observed facts, source case, recommendation reason, rule trace, and conversation into the expert review. |
| Persistence | Preserve existing agent IDs, stages, connections, and saved configurations. Extend each agent with optional practice data. Existing accounts receive sample practice data without rewriting their graph. |

## Experience

The main screen is an expert's practice workspace in the established luminous system: Pretendard, teal actions, mint and sky accents, clear editing surfaces, restrained translucency in navigation, and supported light/dark themes. Use everyday language throughout. The subtle futuristic moment is a case becoming visible, editable guidance and then lighting the relevant path in rehearsal. Motion has a reduced-motion equivalent.

The sidebar groups workspace, agent and consultation tasks. Overview, teaching, knowledge, operating principles, rehearsal and advanced settings have separate URLs with an agent query parameter. Overview shortcuts lead to the same destinations. New consultation applications and AI participation requests share the consultation hub with explicit request types. The dashboard reports pending applications, accepted consultations and participation requests. The mailbox contains system/admin communication; peer messages require backend work. Customer messages remain in chat. The existing pool is labeled public consultation cases, matching its actual contents. Search and collection filters remain available above knowledge results. Mobile shows one main working region at a time; forms and messages stay within the viewport.

## Requirements and acceptance

| Area | Required behavior | Acceptance evidence |
| --- | --- | --- |
| Overview | Named agent, readable three-role flow, primary teaching action, recent cases, and pending review links. | Desktop and mobile browser inspection. |
| Teaching | Required case facts and conclusion; required judgment before review; editable questions, exceptions, and search keywords; back navigation retains work; explicit apply creates linked case and question entries once. | Domain tests for validation and duplicate prevention; browser completes flow and reloads. |
| Knowledge | Separate questions and answer cases; search, inspect/edit, enable/disable, case priority; empty states and only expert-authored entries in the editable list; shared-source attribution in rehearsal. | Tests prove disabled/unrelated cases never supply answers and relevant priority changes selection; browser edit persists. |
| Principles | Editable introduction, style, scope, exclusions, general rules, availability, and engagement conditions. | Saved configuration survives reload; editing structured criteria changes actual deterministic evaluation outcomes. |
| Rehearsal | Common-model introduction, explicit expert-service choice, expert AI identity, editable client question, editable facts from customer and document, unknown markers, repeat-attempt accounting and explicit human requests, source evidence and carried facts. | Tests and browser walk through both transitions. |
| Inbox | Pending requests with reason/context; take over, direct reply, return to AI; no duplicate requests for the same rehearsal. | Tests prove AI pauses during human ownership and context survives. |
| Reliability | Account-separated storage, preserved legacy data, clear save state, retained input on storage error, guarded invalid or corrupted data, accessible keyboard controls. | Existing and added tests; browser error-state check. |

## Prototype contract

This repository is an independent frontend prototype. The release runs with local demo accounts and browser-local data. Teaching organizes supplied fields deterministically. Rehearsal performs keyword matching over enabled case entries and evaluates versioned rules against explicitly entered facts; it does not interpret arbitrary free-text policies, infer new professional judgments, call an LLM, train a model, contact an expert, or publish client access. The UI labels sample cases, rehearsal outputs, and browser-local persistence. There are no invented performance metrics.

The existing client app remains separate from the expert's rehearsal. The complete common-to-expert-to-human flow is demonstrated inside the workspace so the product can be evaluated without a backend integration. Advanced graph execution remains its existing separate simulation and does not claim to consume the new knowledge store.

Production integration will need authenticated server storage, actual retrieval/model execution, live chat delivery, versioned activation, knowledge evaluation, and real expert availability. Those are future integration requirements, not hidden functions of this prototype.

## Approach

1. Write this PRD and [flows](agent-customization-flows.md), and record a surface contract.
2. Write failing behavioral tests for teaching, eligible retrieval, scenario routing, human control, and backward-compatible persistence.
3. Build a small domain layer and extend the existing agent storage without replacing legacy configurations.
4. Build the guided workspace and preserve the technical canvas on its own advanced route.
5. Run the full frontend unit suite, focused lint, production build, and real browser journeys at desktop and mobile sizes. Inspect light, dark, keyboard, storage failure, and empty states.
6. Complete an independent finish review, resolve material findings, document the verified result, and push the completed commit to origin/main.

## Review questions after delivery

Evaluate whether teaching through cases is natural, whether the knowledge review makes the expert's judgment visible, whether the two transitions are clear, and whether the everyday workspace feels approachable enough. The first-pass controls can then be refined using real expert cases.

## Iteration 2 acceptance additions

Task URLs retain the selected agent across sidebar, overview and advanced navigation. Drafts survive route changes and browser history; explicit Save persists them across reload. Unknown agent IDs display recovery without showing another agent as if it matched. The initial sample has a stable per-expert ID. Shared examples edited in the older UI migrate into personal knowledge without data loss. The rule editor exposes all supported criteria, validation and limits; missing facts never become complete through keyword presence, skipped questions or exhausted attempts. The advanced graph and practice editor share one draft library so saving one cannot overwrite changes made in the other.
