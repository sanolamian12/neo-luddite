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

## Expert agent studio

In prototype mode, sign in as `auditor` and open `/audit/agents` (내 에이전트).

- Edit stage instructions, model preset labels, and source notes. Add or remove stages and configure outgoing connections in the inspector.
- Connections select their data (`facts`, `answer`, or `all`) and a condition (always, sample confidence below 70%, or missing facts). Matching incoming connections merge their data; confidence takes the lowest incoming sample value. Cycles and disconnected stages prevent testing.
- The human handoff stage has its own adjustable confidence threshold and an optional missing-facts rule.
- Test three deterministic scenarios. The simulator follows the edited graph and data routing, records the exact instruction/source/model snapshot, and shows executed, blocked, and skipped stages. **It does not interpret prompts, search sources, or invoke an LLM.** Responses and confidence are synthetic; confidence is not a measured probability of correctness.
- Save and duplicate named configurations. `neo-agent-studio-v1:<expert-id>` localStorage entries keep demo expert configurations separate in the same browser. This is local persistence, not production private storage. Saving writes all edited configurations; draft changes are not automatically saved.
- Desktop provides a canvas, instruction inspector and test panel. Mobile switches between workflow, settings and test views; the graph scrolls within its canvas.

Implementation is isolated in `lib/agent-studio.ts`, `components/audit/agents/`, and `app/audit/agents/`. No backend schema changes or new dependencies are needed. The route and menu are hidden in live data mode. Run `npm test` for graph, data-routing, handoff and storage tests alongside the existing prototype checks.

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
