# Consultation and contribution journey

User direction, 2026-10-10: make expert selection a visible transition; distinguish AI from human replies; simplify demo approval and immediately reflect credits; show credit distribution and top contributors; guide role changes at the relevant moment; bring suitable treatments into regular prototype screens.

## Direction contract

**THESIS** — A consultation becomes a professional relationship, then useful shared knowledge. Make these changes visible without interrupting reading or asking the presenter to manage infrastructure.

**OWN-WORLD** — Extend Luminous: customer mint, expert sky, admin bronze, Pretendard, quiet atmospheric backgrounds and opaque message surfaces. A restrained accounting-assistant portrait replaces the generic common-AI blob. Human replies carry an explicit direct-answer label and a distinct sky treatment.

**STORY** — Choose a professional, keep the conversation, recognize who is answering, share a lesson, approve it once, and see the author's credit. Optional records explain how the result happened.

**FIRST VIEWPORT** — Keep role navigation visible and introduce a clear next-person action at handoffs. The chat uses an in-thread arrival stage. Approval places the decision before technical history. Contribution insights pair proportional bars with a ranked contributor list and selectable records.

**FORM** — Existing Operate surfaces; extend their composition rather than creating a new visual world. No randomized form or comp is needed for this refinement.

**FINISH** — unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Boundaries

Demo approval and numeric knowledge credits are browser-local examples, not real KB deployment or monetary rewards. The normal app reuses presentational components and truthful local contribution projections; live service authorization and writes retain their existing paths. Existing unrelated landing, teaching and video work is preserved.

## Implementation

- The accountant connection has a single arrival moment in the conversation, a richer mint/sky field, and an explicit portrait-to-AI relationship. Motion settles once and respects reduced-motion preferences. AI replies stay on opaque paper; human replies use a blue surface, distinct corner, portrait, and `세무사 직접 답변` label.
- The shared common AI is a generated ceramic tax assistant with glasses and a ledger. Its source is `frontend/public/brand/tax-assistant.png`; the exact generation prompt is saved in `design/tax-assistant-avatar-prompt.txt` and embedded in the PNG. Shared avatar and speaker components also serve the regular landing, local chat, assistant thread, and consultation rooms. Rooms retain the existing three-party AI controls and identify speakers from the message role.
- Demo approval is `승인하고 반영`: one local transaction validates the submitted revision, publishes it, and appends one attributed credit. Repeated approvals are idempotent; stale/self-authored/altered submissions fail before publication. The approval history records the approval, not fictitious checkbox verifications. Optional revision feedback and the existing advanced batch workflow remain available.
- `/admin/knowledge-contributions/insights` shows the actual local credit distribution, top contributors, and linked event history. Contributor selection filters the event history; reversals adjust totals. Empty accounts show an honest empty state. Outside the demo, this page projects the existing local contribution board and does not write to the service ledger.
- The compact demo toolbar keeps all three participant roles visible and links directly to the next task at handoffs. Approval points to the credited author's ledger using an explicit author parameter. Checkpoint restoration now prepares the expected consultation state.

## Reusable patterns and system comparison

- Reuse `TaxAgentAvatar` and `SpeakerBadge` from `frontend/components/chat/consultation-identity.tsx`, together with its shared surface and bubble styles. The common assistant has one portrait source, an image-error icon fallback, and an explicit AI label; human answers also have the visible `세무사 직접 답변` label. Keep names and labels beside decorative portraits so identity never depends on imagery or color alone. The small/default/large avatar sizes are 32/44/76px; these are component choices, not additions to the global token scale.
- Pair quiet mint/sky conversation grounds with opaque paper AI messages and sky human messages with distinct corners. Keep the arrival portraits, relationship, and explanation visible together before the first pending reply. The single arrival animation settles and is disabled for reduced motion; it is a handoff treatment, not a new application-wide animation rule.
- Keep the role controls visible, name the next participant and task in the handoff, and let the next action fill the available mobile width. Link author credits using the credited author's identity. The current presenter script is [Three-act demo](three-act-demo.md); advanced review stages remain an optional branch.
- Reuse the contribution summary's labeled amounts and percentages, ranked author buttons, and filterable event list. Visual bars supplement the text. Preserve explicit empty and reversal states, and keep the browser-local credit explanation alongside the numbers.
- Token ownership remains in `frontend/components/design-system/luminous.css`, the root theme boundary, and existing shared aliases. These components consume `--ds-paper`, `--ds-canvas`, `--ds-ink`, `--ds-muted`, `--ds-line`, `--ds-mint`, `--ds-sky`, `--ds-info` / `--ds-info-bg`, `--ds-accent` / `--ds-accent-soft`, `--primary-foreground`, and existing shadow/highlight tokens. Root-owned customer, auditor, and admin palettes supply the current role treatment; this refinement adds no palette primitives or route-owned theme boundary.
- Compared `PRODUCT.md`, normative `DESIGN.md`, and `.impeccable/design.json` with the shared identity component, demo conversation/arrival/presenter styles, contribution insights, and Luminous foundations. Pretendard, the established interface/reading hierarchy, tabular credit figures, opaque reading surfaces, quiet shadows, and visible focus retain the existing Shared Foundation, Independent Axes, and Reading Surface rules. Surface-specific sizes and layouts stay in this brief.

**Main integration:** the latest global design documents now record the root-owned role palettes and demo artwork. This change preserves those updated foundations and records the new shared tax-assistant asset and surface patterns here.

## Verification evidence

- `npm test`: 102 passed; targeted approval/navigation tests passed again after the final navigation correction (8/8). Targeted ESLint and the production build passed.
- Chromium at 1440×1000 and 390×844 exercised accountant selection, direct expert reply, role switching, zero-checkbox approval, two-author distribution, contributor filtering, persistence after reload, attributed ledger navigation, and source trace-back. Two approvals produced exactly two credit events and a total of 2 cr.
- Dark-mode captures cover chat and admin insights. Reduced-motion inspection confirmed the arrival sweep has `animation-name: none`. Mobile inspection found the initial pending bubble pushed the arrival portraits above the viewport; the introductory stage now shows first, before the pending reply appears.
- Regular app checks ran against a production server: guest home → sample chat, and a seeded browser-local consultation room for speaker styling. The room fixture is test data, not a live consultation or a tested backend acceptance flow.
- On the final production build, logging out and signing in as the admin demo account opened the regular insights route with the honest first-contribution empty state and no visible error. The post-restart browser QA session recorded no console errors.
- The Impeccable detector returned no findings on changed design targets. Browser captures are under `output/playwright/journey-refinement/`.

## Integration with current main

The feature was integrated onto `6d82365` in an isolated worktree, preserving newer live chat restoration, three-party room AI controls, prototype-only contribution routes, and root-owned role palettes. Unrelated local landing, teaching, and Remotion edits were left in the original checkout.

- Fresh integrated verification: 107 tests passed, focused ESLint passed, production build passed, and `git diff --check` passed.
- Production Chromium smoke test: zero approval checkboxes; one approval created exactly one event and 1 cr; the insights page showed the credited author and the handoff opened that author's ledger. The mobile ledger visibly showed the author, +1 cr change, and 1 cr balance without horizontal overflow.
- A seeded regular consultation room displayed one human answer and one AI answer with distinct labels and surfaces, with no AI answer mislabeled as human and no mobile horizontal overflow. These are browser-local fixtures, not evidence of live backend behavior.
- Integration captures: `output/playwright/journey-refinement/main-integrated-insights.png`, `main-integrated-ledger-mobile.png`, and `main-integrated-room-mobile.png` in the original checkout.

## Demo controls density refinement

Feedback after the initial release: the demo controls took too much space from the main task. The demo now uses one compact toolbar in place of the separate app header, role cards, three-act strip, and handoff banner. Frequent role switching stays visible; the current act and a `흐름` trigger open the complete journey, checkpoint tools, and theme switch in a viewport-bounded popover. The panel scrolls independently without changing the conversation height, closes on route changes, and supports Escape with focus return.

The next task remains visible in the toolbar on wide insets and in one additional row on narrower insets, only when a next action exists. Responsive layout follows the available workspace width, including the desktop sidebar. Role controls keep 44px hit areas and explicit current-role state. The example helper uses one line; insertion still fills and focuses the editable draft without sending it. Ordinary app headers and domain behavior retain their existing paths.

Production Chromium comparison of the same A5 handoff scene:

| Viewport | Demo/header height before → after | Conversation viewport before → after |
| --- | --- | --- |
| 1440 × 1000 | 249 → 57 px | 466 → 658 px (+41%) |
| 390 × 844 | 276 → 101 px | 299 → 474 px (+59%) |

Verification includes 1024 × 768 and 320 × 568, dark mode, independently scrolling tools, Escape/focus return, checkpoint restoration, customer-to-expert handoff, editable sample insertion without sending, author-specific approval-to-credit navigation, and the regular room header. All 107 tests, focused ESLint, and the production build passed; the Impeccable detector reported no findings. Captures are in `output/playwright/demo-density/` in the original checkout. The final layout assessment found no responsive blocker; a suspected dark contrast issue was a transition capture. Settled selected-role contrast is 6.42:1 and the theme icon remains visible. Earlier visual evidence below describes the original release; this section supersedes its stacked presenter layout.

## Teaching draft and admin spacing follow-up

`선택한 대화로 초안 만들기` now fills all ten review fields in the local demo and focuses the draft heading. Selected customer facts, expert conclusions, and any expert questions retain their original wording and message references. Remaining fields use the prepared, visibly labeled demo examples. `다음: 적용 전 확인` brings the expert to the review confirmations; those confirmations remain unchecked until the expert acts. Ordinary imported transcripts retain the existing source-only extraction behavior.

Admin review uses local spacing overrides to reduce the lead-in, constrain the status filter to 130px, preserve Korean word wrapping, and reduce nested mobile padding. Approval metadata uses a matching local class. Credit totals align even when their labels wrap, while chart/ranking spacing separates groups without repeated blank margins. Batch forms use 16px group gaps and 8px selection gaps; narrow batch tables put the title above labeled author/revision metadata.

- Fresh validation: all 109 tests, focused ESLint, production build, and whitespace checks passed. The layout detector returned no findings.
- Production Chromium verified all ten populated teaching fields, the original expert quotation, heading and review focus, explicit confirmations, applying without additional typing, and persistence after reload. Captures are in `output/playwright/teaching-autofill/` in the original checkout.
- The independent admin spacing confirmation returned **ship** at 1440px, 390px, and 320px: the review filter is 130×44px, all narrow metric values align at y=396.03px, and mobile batch metadata fits without overflow. A fresh run approved the author once (+1 cr) and opened insights and batch detail. Captures are under `output/playwright/admin-spacing/after-*`. An older reused run did not navigate from its review row after the server rebuild, including after reload; this was not reproduced in the fresh run, and its cause remains unconfirmed.

## Finish disposition and documentation verification

- The fresh finish reviewer returned **ship** after inspecting 14 required desktop, mobile, dark-mode, and regular-app captures. It confirmed type, material, ground, role controls, complete mobile arrival, single-action demo approval, attributed credits and distribution, shared regular-app avatar/bubble treatment, and truthful local boundaries. No material fixes remain in that review scope.
- All nine shipping demo/brand raster assets carry embedded generation prompts. The common assistant's exact prompt is also retained in `design/tax-assistant-avatar-prompt.txt`.
- The documenter checked the final source patterns against the incumbent system and checked the recorded test/build/lint evidence. This brief and its registered surface copy are aligned; global `DESIGN.md` and `.impeccable/design.json` remain unchanged. Documentation verification covers content alignment and whitespace; it does not extend the browser fixtures into evidence of live service behavior.
