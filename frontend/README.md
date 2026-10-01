# Neo-Luddite frontend prototype

An independent UI workspace for [neo-luddite](https://github.com/sanolamian12/neo-luddite). Explore frontend changes here while the upstream backend evolves, then port selected components and interactions back through focused pull requests.

The prototype started from `403ba72` (`feat/expert-directory`), retaining the searchable expert directory. The deployable prototype is on `main`; frontend experiments use feature branches.

## Run

Use Node.js 22 or later:

```bash
cd frontend
npm ci
npm run dev
```

Open [localhost:3015/login](http://localhost:3015/login). No Python service, Supabase project, API keys, or environment file is needed. Port 3015 keeps this workspace separate from the original application's browser storage.

Demo accounts share the password `demo1234`:

| Account | Role | Starting screen |
| --- | --- | --- |
| `owner` | Business owner | Occupation selection → clinic conversation replay |
| `auditor` | Reviewer / expert | Dashboard, queue, profile, knowledge |
| `admin` | Operator | Dashboard, sample conversations, tasks, expert registry |

Additional identities (`owner2`–`owner4`, `auditor2`, `auditor3`) appear on the login screen. These are local role simulations, not real authentication or database authorization.

## Expert agent workspace

In prototype mode, sign in as `auditor` and open `/audit/agents` (내 에이전트).

- **한눈에 보기:** understand the three responsibilities and start teaching from an everyday case.
- **가르치기:** describe facts and a conclusion, explain judgment and exceptions, review the case and linked questions, then test a variation. Applying a case adds it once; reviewing and applying again updates that case. Teaching drafts are included in explicit saves.
- **지식 모음:** search and edit separate answer-case and question collections, enable or disable entries, and prioritize relevant cases. Cases contain facts, judgment, conclusion, exceptions, and comma-separated search terms. Rehearsal matches those terms literally in the client question; it is not semantic retrieval. Disabled, incomplete, or unrelated cases cannot supply an answer.
- **운영 원칙:** edit the agent identity, introduction, response style, service scope, exclusions, principles, optional human-engagement triggers, and demo availability. Free-text policies are stored, not interpreted by a model. Scenario controls demonstrate missing facts, conflicts, and exceptions.
- **미리보기:** follow the common model → expert choice → expert AI flow, with a separate direct-human request. The expert-choice step previews the currently edited expert only. See the source case, supplied facts, and judgment behind each example response. Missing or conflicting facts withhold the normal conclusion. No live LLM, semantic RAG, or model training occurs.
- **참여 요청:** inspect rehearsal requests and context, take over (pausing AI), reply in the same thread, and return control to AI. These messages are local simulations, not delivered to clients. Unavailable experts leave requests pending.
- Save, create, and duplicate named configurations. `neo-agent-studio-v1:<expert-id>` localStorage entries retain existing graph configurations and add optional `practice` data. Saving writes all edited configurations, including drafts and review threads. Local account separation is not a production access-control boundary. A failed save retains edits; malformed stored data is not silently replaced.

The existing technical canvas remains at `/audit/agents/advanced`: edit stages, model preset labels, instructions, source notes, connections, and sample-confidence handoff rules. Its separate simulator follows the graph and records instruction snapshots without interpreting them or consuming the new knowledge collection. Both routes preserve the same saved agent library. Save changes before switching to advanced settings.

Implementation is isolated in `lib/agent-practice.ts`, `lib/agent-studio.ts`, `components/audit/agents/`, and `app/audit/agents/`. No backend schema changes or new dependencies are needed. Both routes are hidden in live data mode. Run `npm test` for teaching, retrieval eligibility, scenarios, human control, persistence, graph, and existing prototype checks. See the [PRD](../design/agent-customization-prd.md) and [flows](../design/agent-customization-flows.md) for scope and production follow-up.

## Luminous design system

Open `/design-system` without signing in, or use **새 디자인 시스템 둘러보기**
inside the login screen's prototype controls. This prototype-only specimen shows
the new palette, translucent surfaces, typography, controls, and six card families:
metrics, trends, breakdowns, evidence, experts, and workflow stages.

- Switch between light/dark themes and comfortable/compact spacing.
- Change chart periods, inspect the accessible values table, expand evidence and
  profiles, select workflow stages, and try loading/empty/error/retry states.
- The example form changes only page state. All people, documents, and figures
  are explicitly illustrative; no backend calls or product data edits occur.

Reusable components live in `components/design-system/`. Import `luminous.css`
once, wrap the adopting area in `className="luminous"`, and set `data-theme` to
`light` or `dark`. Optional `data-density="compact"` reduces card padding.
`Surface` separates `material` (`solid`, `tinted`, `glass`), `tone` (`neutral`,
`mint`, `sky`, `amber`), and `density`. `StatusBadge` expresses semantic status
independently of surface color. `LuminousButton` wraps the existing shared Button
with the system's size and opaque hover treatment. Inputs reuse the shared Input;
sparklines reuse the existing SVG component.

The expert dashboard, agent workspace, and advanced Studio use these opt-in tokens.
Other routes retain their existing design. [The surface brief](../design/luminous-system.md)
records the specimen; [DESIGN.md](../DESIGN.md) records the system and migration boundary.

## Scenarios and reset

Expand **프로토타입 · 샘플 데이터** on the login screen:

- **샘플 데이터**: three bundled conversations, nine sample experts, a review task, a consultation request, sample knowledge, and a welcome message.
- **빈 데이터**: empty service collections. Bundled replay conversations and static knowledge guides remain available.
- **느린 응답 (1.5초)**: each mock request waits 1.5 seconds to exercise loading states.
- **오류 응답**: mock requests return 503 to exercise error states. Login remains available.

The scenario persists for the current tab. You can also append `?prototypeScenario=populated`, `empty`, `slow`, or `error` to any route and reload. Example: `/audit/kb2?prototypeScenario=error`. Use `populated` to recover.

Supported data edits persist in localStorage under `neo-luddite-prototype-v1:<scenario>`. **샘플 데이터 초기화** resets those sample collections; it preserves demo login and unrelated UI preferences. Scenarios have separate data. Browser tabs do not synchronize in realtime.

## What is simulated

- Local demo login/logout and existing role navigation.
- Existing table reads and basic CRUD through the Supabase client, backed by local fixtures.
- Expert listing, filtering/pagination, profile changes, and like toggles.
- A prototype-only expert handoff in replay conversations, including local consultation requests and their status pages.
- Existing deterministic chat replay; live AI chat is disabled.
- Sample KB2 groups/documents/sentences, source passages, and basic RAG summary reads.
- Collection refresh in the current tab after supported edits.

This is a UI foundation, not an emulator of the entire backend. Database triggers, authorization rules, consultation transitions and room creation, offers, avatar uploads, knowledge synthesis/editing, embeddings, real AI responses, and other unimplemented RPC/API operations are **not simulated**. Unsupported requests return `501 PROTOTYPE_UNSUPPORTED`; they never fall through to a live service. Add a focused handler and behavioral test when prototyping one of those flows.

The adapter keeps existing service interfaces intact. Compatibility fields such as `dbConfigured` describe fixture response shapes, not a real database connection.

## Code boundaries

| Location | Responsibility |
| --- | --- |
| `components/`, `app/` | UI to evolve and selectively contribute upstream |
| `services/` | Existing typed operations consumed by the UI |
| `lib/data-mode.ts` | Selects prototype or live integrations |
| `lib/prototype/fixtures.ts` | Editable sample data |
| `lib/prototype/backend.ts` | Local requests, scenarios, persistence, collection notifications |
| `lib/supabase/client.ts`, `lib/api-fetch.ts` | Transport selection |

Prototype mode is the default, including production builds. It ignores live backend settings. Only `NEXT_PUBLIC_DATA_MODE=live` selects the original integrations and requires their environment configuration. Next.js embeds public variables at build time: rebuild when changing modes. The default build is a demo, not a production authentication boundary.

## Checks

```bash
npm test
npx tsc --noEmit
npm run build
```

`npm test` runs the existing expert-directory tests plus prototype isolation, login, CRUD, schema, persistence, scenario, and reset checks. `npm run lint` also scans upstream files with existing lint failures.

The inherited `e2e/` integration suite targets a live Supabase/Python deployment and can mutate its database; it is not the prototype test command. Browser checks here use port 3015 and local fixtures.

## Bringing improvements upstream

This local clone has `origin` pointing to the fork and `upstream` pointing to the original. On a fresh clone, add upstream once:

```bash
git remote add upstream git@github.com:sanolamian12/neo-luddite.git
```

Keep each frontend experiment in focused commits. When an idea is ready, fetch upstream, create a contribution branch from current `upstream/main`, port that UI change, and adapt its service calls to the new backend. Open a PR from that branch. Avoid merging the prototype branch wholesale: local authentication, sample data, and the adapter belong to this prototype.

The `backend/` and `supabase/` trees remain as upstream reference material and are not needed to run this workspace.
