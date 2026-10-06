# Complete sample response UI

Mode: Operate. Extend the approved luminous system without changing its tokens or redesigning unrelated surfaces.

The guest/local chat previously generated one text segment and flattened every message with `messageText`. The sample now uses the existing segment renderer and structured verdict/evidence/expert components. The first reply includes all supported UI block kinds, source metadata and a framework badge. Sample verdicts and sources are explicitly illustrative; no tax determination or invented legal authority is presented as real.

Existing stored text-only replies receive the same UI on hydration while keeping message/segment IDs, text, drafts and account scope. Subsequent replies remain structured. The active expert handoff appears once, with the latest reply. Guests can browse/filter experts and continue through login; consultation persistence and request actions remain scoped to an authenticated owner. Existing replay/live handoffs preserve their behavior.

A long reply opens at its beginning. The composer stays in its existing fixed section, with structured content available by scrolling. Use the existing solid cards and theme-aware controls; do not add a card around the whole assistant response.

Verification: meaningful store regression tests for generated and migrated structured messages, existing persistence/retry/isolation tests, desktop/mobile browser checks for all blocks, old-chat hydration, guest expert browsing and authenticated request continuation. Preserve unrelated work in the shared checkout; implementation is isolated in the rich-sample-responses worktree.

Verified on 2026-10-06: all 74 tests, TypeScript, targeted ESLint and the production build pass. Browser checks confirm all three cards and source metadata on new and restored replies, guest search and login continuation, and successful local consultation creation. No horizontal overflow at 320, 390, 768 or 1440 pixels; light/dark desktop and mobile captures include the picker, request sheet and confirmation. The final flow produced no page errors or external requests. The design detector returned no findings on changed UI targets.

The finish review identified misleading real-delivery/contact promises in the inherited handoff copy. Prototype request, sharing and confirmation states now explicitly describe browser-local simulation, while live-mode copy stays intact. This extension adds no design tokens or shipping raster assets.
