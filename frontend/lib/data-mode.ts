/** The fork is local by default. Live integration must be deliberately enabled. */
export const isPrototype = process.env.NEXT_PUBLIC_DATA_MODE !== "live";
export const prototypeOrigin = "https://prototype.invalid";

export function getApiBase(): string {
  if (isPrototype) return prototypeOrigin;
  const base = process.env.NEXT_PUBLIC_API_BASE;
  if (!base) throw new Error("NEXT_PUBLIC_API_BASE is required in live mode.");
  return base;
}
