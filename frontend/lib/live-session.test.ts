import assert from "node:assert/strict";
import { after, test } from "node:test";
process.env.NEXT_PUBLIC_DATA_MODE = "live";
const storage = new Map<string, string>([["account-store-v1", JSON.stringify({ version: 3, state: { session: "admin", authReady: true, admin: { id: "admin", role: "admin" } } })]]);
Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } } });
after(() => { Reflect.deleteProperty(globalThis, "window"); });
test("live auth never restores a forged local account, even after rehydration", async () => {
  const { useAccountStore } = await import("./account-store");
  await useAccountStore.persist.rehydrate();
  assert.equal(useAccountStore.getState().session, null);
  assert.equal(useAccountStore.getState().authReady, false);
});
test("missing configuration resolves to a guest instead of hanging a protected page", async () => {
  const { useAccountStore, startAccountSession } = await import("./account-store");
  const stop = startAccountSession();
  assert.equal(useAccountStore.getState().authReady, true);
  assert.equal(useAccountStore.getState().session, null);
  stop();
});
