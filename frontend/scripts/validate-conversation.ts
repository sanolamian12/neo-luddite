import { readFileSync, readdirSync } from "node:fs";
import { conversationSchema } from "../lib/conversation-schema.ts";

const dir = new URL("../data/conversations/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

let ok = 0;
for (const f of files) {
  const raw = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
  const res = conversationSchema.safeParse(raw);
  if (!res.success) {
    console.error(`✗ ${f}: ${res.error.issues[0].message}`);
    process.exitCode = 1;
    continue;
  }
  const conv = res.data;
  const segs = conv.messages.flatMap((m) => m.segments.map((s) => s.id));
  const unique = new Set(segs).size === segs.length;
  const hasMeta = conv.messages.some((m) =>
    m.segments.some((s) => s.framework && s.citations?.length),
  );
  const hasUi = conv.messages.some((m) => (m.uiBlocks?.length ?? 0) > 0);
  console.log(
    `✓ ${f} — msgs=${conv.messages.length} segs=${segs.length} uniqueIds=${unique} meta=${hasMeta} ui=${hasUi}`,
  );
  ok++;
}
console.log(`\n${ok}/${files.length} conversations valid`);

// 부정 케이스: 중복 세그먼트 ID 거부 확인
const sample = JSON.parse(
  readFileSync(new URL("clinic-vehicle.json", dir), "utf8"),
);
sample.messages[1].segments[0].id = sample.messages[0].segments[0].id;
const bad = conversationSchema.safeParse(sample);
console.log(`✓ duplicate-id rejected: ${!bad.success}`);
