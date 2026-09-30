import assert from "node:assert/strict";
import { test } from "node:test";
import { PrototypeBackend } from "./backend";

function memoryStorage(values: Map<string, string>): Storage {
  return {
    get length() { return values.size; },
    clear: () => { values.clear(); },
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

test("reset removes prototype data while preserving unrelated browser storage", async () => {
  const backendModule = await import("./backend");
  const values = new Map([["neo-luddite-prototype-v1:populated", "{}"], ["account-store-v1", "keep"], ["prototype-account-v1", "keep-demo-login"]]);
  const storage = memoryStorage(values);
  assert.equal(typeof backendModule.resetPrototypeData, "function");
  backendModule.resetPrototypeData(storage);
  assert.equal(values.has("neo-luddite-prototype-v1:populated"), false);
  assert.equal(values.get("account-store-v1"), "keep");
  assert.equal(values.get("prototype-account-v1"), "keep-demo-login");
});

test("empty and error scenarios expose different states without falling back to live services", async () => {
  const empty = new PrototypeBackend("empty");
  assert.deepEqual(await (await empty.fetch("https://prototype.invalid/rest/v1/auditors")).json(), []);
  assert.deepEqual((await (await empty.fetch("https://prototype.invalid/api/kb2/documents")).json()).documents, []);
  const error = await new PrototypeBackend("error").fetch("https://prototype.invalid/rest/v1/auditors");
  assert.equal(error.status, 503);
  assert.match((await error.json()).message, /Switch to populated/);
});

test("slow scenario remains pending until its delay and honors cancellation", async () => {
  const backend = new PrototypeBackend("slow");
  const controller = new AbortController();
  let settled = false;
  const request = backend.fetch("https://prototype.invalid/rest/v1/auditors", { signal: controller.signal });
  request.then(() => { settled = true; }, () => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(settled, false);
  controller.abort();
  await assert.rejects(request, { name: "AbortError" });
});

test("local changes survive reload and notify subscribed collections", async () => {
  const values = new Map<string, string>();
  const storage = memoryStorage(values);
  const backend = new PrototypeBackend("populated", storage);
  let notifications = 0;
  const unsubscribe = backend.subscribe("auditors", () => { notifications++; });
  const response = await backend.fetch("https://prototype.invalid/rest/v1/auditors?id=eq.auditor", { method: "PATCH", body: JSON.stringify({ display_name: "Edited sample" }) });
  assert.equal(response.status, 200);
  assert.equal(notifications, 1);
  unsubscribe();
  const reloaded = new PrototypeBackend("populated", storage);
  const rows = await (await reloaded.fetch("https://prototype.invalid/rest/v1/auditors?id=eq.auditor")).json();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].display_name, "Edited sample");
  assert.equal((await (await new PrototypeBackend("empty", storage).fetch("https://prototype.invalid/rest/v1/auditors")).json()).length, 0);
});

test("unknown tables and RPCs cannot report a successful operation", async () => {
  const backend = new PrototypeBackend();
  for (const path of ["/rest/v1/not_a_table", "/rest/v1/rpc/not_implemented"]) {
    assert.equal((await backend.fetch(`https://prototype.invalid${path}`, { method: "POST", body: "{}" })).status, 501);
  }
  for (const path of ["/unknown/versions", "/unknown/sources"]) {
    assert.equal((await backend.fetch(`https://prototype.invalid${path}`)).status, 501);
  }
});
