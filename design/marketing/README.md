# Public search and sharing metadata

The original acquisition destination is `https://neo-luddite.vercel.app/`.

Only `/`, `/about` and `/privacy` opt in to indexing and receive canonical and Open Graph/Twitter metadata. The root layout defaults to `noindex, nofollow`; new public pages need an explicit metadata decision. The sitemap contains only those three fixed URLs and reads no application data. Personal chats, rooms, consultations, account screens and staff workspaces are excluded. Robots crawl directives are not authorization or a guarantee that previously discovered URLs disappear from a search engine.

The existing page titles and home/about descriptions are preserved. The privacy page keeps its operator name and gets a description of its existing contents. Campaign parameters do not appear in canonical or share URLs. No new analytics, database changes or environment variables are required.

## Static shared image

- Output: `frontend/public/brand/social-preview.png` (1200 × 630).
- Editable source: `social-preview.html`, using the existing Pretendard font, public-homepage copy, colors, and ImprintMark/ImprintContours geometry from `frontend/components/design-system/imprint.tsx`.
- To regenerate, serve the repository root over local HTTP, open `/design/marketing/social-preview.html` in Chromium at a 1200 × 630 viewport with device scale factor 1, wait for `document.fonts.ready`, then save a viewport PNG to the output path. The source has no external assets or scripts.
- The PNG is served directly; no runtime image generation or external image service is used.

## Verification

From `frontend/`:

```sh
npm test
npx tsc --noEmit
npm run build
npx next start --port 3026
```

In another terminal:

```sh
METADATA_BASE_URL=http://127.0.0.1:3026 npm run test:metadata
```

The HTTP checks cover public canonical/share metadata with and without campaign queries, inherited noindex and absent canonicals on representative private routes, sitemap contents, robots exclusions and the PNG signature/dimensions. They do not submit chats, forms, analytics or account requests. Social-network preview caches and search-engine indexing need checking after an approved deployment; passing local HTTP checks does not establish either outcome.
