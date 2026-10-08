# Neo-Luddite frontend prototype

An independent UI prototype of [sanolamian12/neo-luddite](https://github.com/sanolamian12/neo-luddite), using browser-local sample data while the original backend evolves.

For real registration and login in the upstream service, follow the [Supabase social authentication setup](design/supabase-auth.md). It covers Google/Kakao, the required database migration, provider credentials, and live-mode configuration. The quick start below retains the offline prototype.

```bash
cd frontend
npm ci
npm run dev
```

Open **http://localhost:3015/login**. Use `owner`, `auditor`, or `admin` with the demo password `demo1234`.

No backend or environment file is required. The login screen includes sample, empty, slow, and error scenarios. Backend workflows that have not been simulated return an explicit unavailable response.

The **expert agent workspace** is at **http://localhost:3015/audit/agents** after signing in as `auditor`. Teach through cases, edit question and answer knowledge, set operating principles, rehearse the client journey, and take over a simulated conversation. Configurations and teaching drafts stay in this browser, separated by demo expert identity. Rehearsal uses transparent keyword matching and scenario-based responses; no LLM or remote retrieval service is called. The existing model and graph editor remains at `/audit/agents/advanced`.

Read the [product requirements](design/agent-customization-prd.md), [user flows](design/agent-customization-flows.md), and [original vision](design/agent-customization-vision.md).

See [frontend/README.md](frontend/README.md) for supported flows, mock data, tests, and how to contribute selected frontend improvements upstream.

## Deploy on Vercel

Import `ugnchoi/neo-luddite-prototype` with these settings:

- Production branch: `main`
- Root directory: `frontend`
- Framework preset: Next.js
- Build command: `npm run build` (default)
- Output directory: framework default
- Environment variables: none required; prototype mode is the default

After deployment, open `/audit/agents` and sign in with `auditor` / `demo1234`. The deployed app remains a demo with browser-local data and simulated authentication.
