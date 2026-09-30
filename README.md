# Neo-Luddite frontend prototype

An independent UI prototype of [sanolamian12/neo-luddite](https://github.com/sanolamian12/neo-luddite), using browser-local sample data while the original backend evolves.

```bash
cd frontend
npm ci
npm run dev
```

Open **http://localhost:3015/login**. Use `owner`, `auditor`, or `admin` with the demo password `demo1234`.

No backend or environment file is required. The login screen includes sample, empty, slow, and error scenarios. Backend workflows that have not been simulated return an explicit unavailable response.

See [frontend/README.md](frontend/README.md) for supported flows, mock data, tests, and how to contribute selected frontend improvements upstream.
