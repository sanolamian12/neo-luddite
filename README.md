# Neo-Luddite frontend prototype

An independent UI prototype of [sanolamian12/neo-luddite](https://github.com/sanolamian12/neo-luddite), using browser-local sample data while the original backend evolves.

```bash
cd frontend
npm ci
npm run dev
```

Open **http://localhost:3015/login**. Use `owner`, `auditor`, or `admin` with the demo password `demo1234`.

No backend or environment file is required. The login screen includes sample, empty, slow, and error scenarios. Backend workflows that have not been simulated return an explicit unavailable response.

The **agent studio** is at **http://localhost:3015/audit/agents** after signing in as `auditor`. Edit LLM stages, instructions, data connections, and human-expert handoff rules; save multiple configurations and inspect a simulated run. Configurations stay in this browser, separated by demo expert identity. Responses and confidence values are illustrative; no LLM or retrieval service is called.

See [frontend/README.md](frontend/README.md) for supported flows, mock data, tests, and how to contribute selected frontend improvements upstream.
