import { createFixtures, createKnowledgeFixtures, type Row, type Tables } from "./fixtures";

export type Scenario = "populated" | "empty" | "slow" | "error";
export const scenarios: Scenario[] = ["populated", "empty", "slow", "error"];
const storagePrefix = "neo-luddite-prototype-v1";

export function resetPrototypeData(storage: Storage): void {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  for (const key of keys) if (key?.startsWith(`${storagePrefix}:`)) storage.removeItem(key);
}

export function getScenario(): Scenario {
  if (typeof window === "undefined") return "populated";
  const selected = new URLSearchParams(window.location.search).get("prototypeScenario");
  try {
    if (scenarios.includes(selected as Scenario)) window.sessionStorage.setItem(`${storagePrefix}:scenario`, selected!);
    const stored = window.sessionStorage.getItem(`${storagePrefix}:scenario`);
    return scenarios.includes(stored as Scenario) ? stored as Scenario : "populated";
  } catch { return "populated"; }
}

const json = (data: unknown, status = 200) => Response.json(data, { status });
const unsupported = (operation: string) => json({ code: "PROTOTYPE_UNSUPPORTED", message: `Not simulated in this prototype: ${operation}` }, 501);

/** Local transport for the existing services. It has no network fallback. */
export class PrototypeBackend {
  private tables: Tables;
  private listeners = new Map<string, Set<() => void>>();
  private knowledge = createKnowledgeFixtures();

  constructor(readonly scenario: Scenario = "populated", private storage?: Storage) {
    this.tables = createFixtures();
    if (scenario === "empty") {
      for (const table of Object.keys(this.tables)) this.tables[table] = [];
      this.knowledge = { groups: [], documents: [], sentences: [], passages: [] };
    }
    try {
      const stored = storage?.getItem(`${storagePrefix}:${scenario}`);
      if (stored) this.tables = { ...this.tables, ...JSON.parse(stored) };
    } catch { /* A blocked or outdated browser cache falls back to fixtures. */ }
  }

  subscribe(table: string, listener: () => void): () => void {
    if (!this.listeners.has(table)) this.listeners.set(table, new Set());
    this.listeners.get(table)!.add(listener);
    return () => { this.listeners.get(table)?.delete(listener); };
  }

  private changed(table: string) {
    try { this.storage?.setItem(`${storagePrefix}:${this.scenario}`, JSON.stringify(this.tables)); } catch { /* In-memory mode still works. */ }
    for (const listener of this.listeners.get(table) ?? []) listener();
  }

  fetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (this.scenario === "slow") {
      await new Promise<void>((resolve, reject) => {
        request.signal.throwIfAborted();
        const abort = () => { clearTimeout(timer); reject(request.signal.reason); };
        const timer = setTimeout(() => { request.signal.removeEventListener("abort", abort); resolve(); }, 1500);
        request.signal.addEventListener("abort", abort, { once: true });
      });
    }
    request.signal.throwIfAborted();
    if (this.scenario === "error") return json({ code: "PROTOTYPE_ERROR", message: "Simulated prototype service error. Switch to populated to recover." }, 503);
    const url = new URL(request.url);
    const body = request.method === "GET" || request.method === "HEAD" ? {} : await request.json().catch(() => ({}));
    if (url.pathname.startsWith("/rest/v1/rpc/")) return this.rpc(url.pathname.split("/").at(-1)!, body);
    if (url.pathname.startsWith("/rest/v1/")) return this.rest(url, request, body);
    if (request.method !== "GET") return unsupported(`${request.method} ${url.pathname}`);
    return this.api(url);
  };

  private rest(url: URL, request: Request, body: Row | Row[]): Response {
    const table = url.pathname.slice("/rest/v1/".length);
    if (!Object.hasOwn(this.tables, table)) return unsupported(`table ${table}`);
    const filters = [...url.searchParams].filter(([key]) => !["select", "order", "limit", "offset", "on_conflict"].includes(key));
    const supported = /^(eq|neq|is|in|gte|lte|gt|lt)\./;
    if (filters.some(([, expression]) => !supported.test(expression))) return unsupported("query filter");
    const matches = (row: Row) => filters.every(([key, expression]) => {
      const [column, field] = key.split("->>");
      const value = field ? (row[column] as Row | undefined)?.[field] : row[column];
      const dot = expression.indexOf(".");
      const op = expression.slice(0, dot), expected = expression.slice(dot + 1);
      if (op === "eq") return String(value) === expected;
      if (op === "neq") return String(value) !== expected;
      if (op === "is") return expected === "null" ? value == null : String(value) === expected;
      if (op === "in") return expected.slice(1, -1).split(",").map((v) => v.replace(/^"|"$/g, "")).includes(String(value));
      const left = Number(value), right = Number(expected);
      return op === "gte" ? left >= right : op === "lte" ? left <= right : op === "gt" ? left > right : left < right;
    });
    let rows = this.tables[table].filter(matches);
    if (request.method === "POST") {
      const incoming = (Array.isArray(body) ? body : [body]).map((row) => ({ id: crypto.randomUUID(), created_at: Date.now(), ...row }));
      const key = url.searchParams.get("on_conflict") ?? "id";
      const upsert = request.headers.get("prefer")?.includes("resolution=merge-duplicates");
      for (const row of incoming) {
        const existing = upsert ? this.tables[table].find((r) => r[key] === row[key as keyof typeof row]) : undefined;
        if (existing) Object.assign(existing, row);
        else this.tables[table].push(row);
      }
      rows = incoming;
      this.changed(table);
    } else if (request.method === "PATCH") {
      rows.forEach((row) => Object.assign(row, body));
      this.changed(table);
    } else if (request.method === "DELETE") {
      this.tables[table] = this.tables[table].filter((row) => !matches(row));
      this.changed(table);
    } else if (!["GET", "HEAD"].includes(request.method)) return unsupported(request.method);

    const order = url.searchParams.get("order");
    if (order) {
      const [column, direction] = order.split(".");
      rows.sort((a, b) => (typeof a[column] === "number" ? Number(a[column]) - Number(b[column]) : String(a[column]).localeCompare(String(b[column]))) * (direction === "desc" ? -1 : 1));
    }
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const total = rows.length;
    rows = rows.slice(offset, offset + Number(url.searchParams.get("limit") ?? rows.length));
    const select = url.searchParams.get("select");
    if (select && select !== "*") rows = rows.map((row) => Object.fromEntries(select.split(",").map((key) => [key, row[key]])));
    if (request.method === "HEAD") return new Response(null, { headers: { "content-range": `0-${Math.max(0, total - 1)}/${total}` } });
    if (request.headers.get("accept")?.includes("application/vnd.pgrst.object+json")) {
      if (rows.length !== 1) return json({ code: "PGRST116", message: "Expected exactly one row", details: `The result contains ${rows.length} rows` }, 406);
      return json(rows[0]);
    }
    return json(rows);
  }

  private rpc(name: string, body: Row): Response {
    if (name === "list_experts") return json(this.tables.expert_profiles.filter((p) => p.listed).map((profile, index) => {
      const auditor = this.tables.auditors.find((a) => a.id === profile.auditor_id);
      const liked = this.tables.expert_likes.some((like) => like.expert_id === profile.auditor_id);
      return { ...profile, display_name: auditor?.display_name, qualifications: auditor?.qualifications ?? [], like_count: 10 - index + Number(liked), liked_by_me: liked, reviewed_count: index + 1, reviewed_this_case: index === 0 };
    }));
    if (name === "toggle_expert_like") {
      const index = this.tables.expert_profiles.findIndex((p) => p.auditor_id === body.p_expert_id);
      if (index < 0) return json({ message: "Expert not found" }, 404);
      const liked = !this.tables.expert_likes.some((like) => like.expert_id === body.p_expert_id);
      this.tables.expert_likes = this.tables.expert_likes.filter((like) => like.expert_id !== body.p_expert_id);
      if (liked) this.tables.expert_likes.push({ expert_id: body.p_expert_id });
      this.changed("expert_likes");
      return json([{ liked, like_count: 10 - index + Number(liked) }]);
    }
    if (name === "list_pool_cases") return json([]);
    return unsupported(`RPC ${name}`);
  }

  private api(url: URL): Response {
    const path = url.pathname;
    const { groups, documents, sentences, passages } = this.knowledge;
    if (path === "/api/kb2/groups") return json({ groups, dbConfigured: true });
    if (path === "/api/kb2/documents") return json({ documents, dbConfigured: true });
    if (/^\/api\/kb2\/documents\/[^/]+\/sentences$/.test(path)) return json({ sentences: sentences.filter((s) => s.documentId === path.split("/")[4]), dbConfigured: true });
    if (/^\/api\/kb2\/sentences\/[^/]+\/sources$/.test(path)) return json({ passages, dbConfigured: true });
    if (/^\/api\/kb2\/sentences\/[^/]+\/versions$/.test(path)) return json({ versions: [], dbConfigured: true });
    if (path === "/api/rag/passages") return json({ passages: passages.filter((p) => (!url.searchParams.has("conversationId") || p.conversationId === url.searchParams.get("conversationId")) && (!url.searchParams.has("sourceKind") || p.sourceKind === url.searchParams.get("sourceKind"))), dbConfigured: true });
    if (path === "/api/rag/edges") return json({ edges: [], dbConfigured: true });
    if (path === "/api/rag/contributions") return json({ contributions: [], dbConfigured: true });
    if (path === "/api/rag/stats") return json({ dbConfigured: true, ragEnabled: false, totalActive: passages.length, totalRetired: 0, conversations: this.tables.conversations.length, auditors: this.tables.auditors.length, bySourceKind: [{ sourceKind: "feedback", count: passages.length }] });
    if (path === "/api/norms") return json({ documents: [], maxChars: 6000, activeChars: 0, injectedSource: "none", injectedChars: 0, fastApprovals: 2, objectionPeriodSec: 86400, dbConfigured: true });
    return unsupported(`GET ${path}`);
  }
}

let backend: PrototypeBackend | undefined;
export function getPrototypeBackend(): PrototypeBackend {
  if (!backend) {
    let storage: Storage | undefined;
    try { storage = typeof window === "undefined" ? undefined : window.localStorage; } catch { /* Storage may be blocked. */ }
    backend = new PrototypeBackend(getScenario(), storage);
  }
  return backend;
}
