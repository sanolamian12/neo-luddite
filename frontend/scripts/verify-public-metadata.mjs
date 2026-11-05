import assert from "node:assert/strict";
import { test } from "node:test";

// Run against a running build: METADATA_BASE_URL=http://127.0.0.1:3026 npm run test:metadata
const base = process.env.METADATA_BASE_URL ?? "http://127.0.0.1:3026";
const site = "https://neo-luddite.vercel.app";
const pages = [
  ["/", "Credigraph — 세무사가 함께 만들고 다듬는 AI 세무상담"],
  ["/about", "서비스 소개 — Credigraph"],
  ["/privacy", "개인정보처리방침 | 네오러다이트"],
];

async function read(path) {
  const response = await fetch(new URL(path, base));
  assert.equal(response.status, 200, path);
  return response.text();
}

function tags(html, tag) {
  return [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "g"))].map(([element]) =>
    Object.fromEntries([...element.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value])),
  );
}

for (const [path, title] of pages) {
  test(`public ${path} canonical and previews stay on the original host, including campaign URLs`, async () => {
    for (const query of ["", "?utm_source=naver_blog&utm_campaign=launch&ref=sample"]) {
      const html = await read(`${path}${query}`);
      const meta = tags(html, "meta");
      const get = (name) => meta.find((item) => item.name === name || item.property === name)?.content;
      const canonical = tags(html, "link").filter((item) => item.rel === "canonical");
      assert.deepEqual(canonical.map((item) => new URL(item.href).href), [`${site}${path}`]);
      assert.equal(get("robots"), "index, follow");
      assert.equal(new URL(get("og:url")).href, `${site}${path}`);
      assert.equal(get("og:title"), title);
      assert.equal(get("twitter:title"), title);
      assert.equal(get("og:description"), get("description"));
      assert.equal(get("twitter:description"), get("description"));
      assert.ok(get("description")?.length > 20);
      assert.equal(get("og:image"), `${site}/brand/social-preview.png`);
      assert.equal(get("twitter:image"), `${site}/brand/social-preview.png`);
      assert.equal(get("og:image:width"), "1200");
      assert.equal(get("og:image:height"), "630");
      assert.equal(get("twitter:card"), "summary_large_image");
    }
  });
}

test("account, chat and workspace pages inherit noindex without a public canonical", async () => {
  for (const path of ["/login", "/chat/clinic?c=private-test", "/consultations/private-test", "/rooms/private-test", "/audit", "/admin", "/demo", "/expert/apply"]) {
    const html = await read(path);
    assert.ok(tags(html, "meta").some((item) => item.name === "robots" && item.content.includes("noindex")), path);
    assert.equal(tags(html, "link").some((item) => item.rel === "canonical"), false, path);
  }
});

test("sitemap advertises only the three public original-product pages", async () => {
  const xml = await read("/sitemap.xml");
  assert.deepEqual([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, url]) => url), [
    "https://neo-luddite.vercel.app/",
    "https://neo-luddite.vercel.app/about",
    "https://neo-luddite.vercel.app/privacy",
  ]);
});

test("robots excludes personal and operational route families", async () => {
  const robots = await read("/robots.txt");
  assert.match(robots, /^User-Agent: \*$/m);
  assert.match(robots, /^Sitemap: https:\/\/neo-luddite\.vercel\.app\/sitemap\.xml$/m);
  for (const route of ["/api/", "/chat", "/consultations", "/rooms", "/audit", "/admin", "/account", "/auth", "/login", "/register", "/forgot-password", "/reset-password", "/expert", "/select", "/offers", "/demo", "/design-system", "/r/"]) {
    assert.ok(robots.split("\n").includes(`Disallow: ${route}`), route);
  }
});

test("shared preview is a public 1200 × 630 PNG", async () => {
  const response = await fetch(new URL("/brand/social-preview.png", base));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /image\/png/);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(bytes.readUInt32BE(16), 1200);
  assert.equal(bytes.readUInt32BE(20), 630);
});
