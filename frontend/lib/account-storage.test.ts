import assert from "node:assert/strict";
import { after, test } from "node:test";

process.env.NEXT_PUBLIC_DATA_MODE = "prototype";
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const blockedStorage = {
  getItem: (): string | null => { throw new Error("Storage blocked"); },
  setItem() { throw new Error("Storage blocked"); },
  removeItem() { throw new Error("Storage blocked"); },
};
Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: blockedStorage } });
after(() => {
  if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

test("blocked account storage does not leave guest entry waiting for hydration", async () => {
  const { useAccountStore } = await import("./account-store");
  assert.equal(useAccountStore.persist?.hasHydrated(), true);
  assert.equal(useAccountStore.getState().session, null);
  assert.equal(await useAccountStore.getState().login("owner", "demo1234"), "viewer");
  await useAccountStore.getState().logout();
  assert.equal(useAccountStore.getState().session, null);
});

test("invalid account JSON falls back to a hydrated guest session", async () => {
  blockedStorage.getItem = () => "{invalid json";
  const { useAccountStore } = await import("./account-store");
  await useAccountStore.persist.rehydrate();
  assert.equal(useAccountStore.persist.hasHydrated(), true);
  assert.equal(useAccountStore.getState().session, null);
});
