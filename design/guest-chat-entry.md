# Guest-first conversation entry

Mode: Persuade on `/`, Operate in chat. This implements the user's approved entry-flow plan on the completed luminous design system.

THESIS: The first question is the entrance. A visitor can describe a situation immediately, then carry that same conversation into an account and, when needed, an expert consultation.

OWN-WORLD: Inherit luminous Pretendard, mist, teal ink, mint/sky atmosphere, solid reading surfaces, shared controls, theme behavior, and workspace chrome. No new global tokens, imagery, or dependencies.

FIRST VIEWPORT: An asymmetric two-column composition pairs a situation-led Korean headline on the left with an actual question composer on the right. Editable clinic sample prompts demonstrate what can be asked. Top-right login is secondary. Mobile stacks a compact hero above the composer and preserves a usable first viewport.

SIGNATURE INTERACTION: The first send creates a stable conversation before navigation. The embedded composer becomes a full chat workspace with that same question; no industry picker or login intervenes. Navigation, refresh, cancelled login, and authentication preserve drafts and messages when browser storage is available. Denied storage retains a usable in-memory session; it cannot preserve that session through a reload.

## Relationship to the incumbent system

This is an ordinary surface extension. [PRODUCT.md](../PRODUCT.md), [DESIGN.md](../DESIGN.md), and [.impeccable/design.json](../.impeccable/design.json) remain unchanged. The implementation inherits the document-level theme, Pretendard, Lucide icons, luminous color and material tokens, control and panel radii, stronger field boundary, paired primary foreground, shared workspace navigation, and existing focus and motion preferences. The composer uses paper with the field boundary; the landing panel uses the existing solid material, panel radius, floating shadow, and inset highlight. These are compositions of existing foundations, not new global primitives.

The landing's 1360px maximum width, asymmetric columns, local headline scale, and single-column transition at 760px are specific to this entry. The chat has its own scrolling transcript and a separate composer, with a 780px maximum reading width and mobile safe-area padding. Prompt selection fills and focuses the editable composer; Enter sends, Shift + Enter adds a line, and composition input is respected. Owner handoff is a disclosure within the conversation. Account role changes expand navigation without replacing the shared visual system.

The incumbent `DESIGN.md` still describes the previous centered home and its public display size. This brief records the replacement home composition without promoting it to an application-wide layout rule or rewriting that incumbent snapshot. The scoped source comparison found no additional pre-existing token drift to repair.

## Account transitions

- Guest: local conversations, new chat, and sidebar login. Sample replies gather context and are explicitly illustrative.
- Owner: the current guest conversation is adopted once into the current owner scope. The sidebar expands to consultation tools, saved chats, and expert rooms. Adopted chats can enter the existing local expert-request flow.
- Expert/admin: the current trial stays separate from owner/client data. A labeled workspace link enters the existing guarded dashboard, and the account menu returns to the trial chat.
- Login without a return context goes to the account's default route. Return paths are local and role-checked. Logging out returns to the public entry; owned history is not exposed as guest history.

## Implementation boundaries

The prototype remains local. `entry-chat.ts` owns versioned, scenario-scoped conversations and drafts; `entry-chat-store.ts` connects them to the browser. Async replies are bound to conversation and turn IDs. Failed/interrupted replies can resume without inserting another user message. Owner synchronization marks records as prototype data. Existing replay samples and live-mode integration remain separate.

Chat alone has a public shell. Consultations, offers, rooms, expert tools, and operations continue to use their existing role guards. Current sample coverage is clinic-focused; arbitrary input is retained, but this is not live AI or substantive tax advice.

## Code map

| Area | Sources |
| --- | --- |
| Public entry and local composition | `frontend/app/page.tsx`, `frontend/app/entry.module.css`, `frontend/components/chat/landing-chat.tsx` |
| Composer, editable prompts, transcript, and recovery | `frontend/components/chat/entry-composer.tsx`, `entry-prompts.tsx`, `local-chat-experience.tsx`, `entry-chat.module.css` |
| Guest and role navigation | `frontend/components/layout/entry-sidebar.tsx`, `chat-shell.tsx`, `public-account-nav.tsx`; existing public header, workspace shell, and account switcher |
| Conversation identity, drafts, retries, and browser hydration | `frontend/lib/entry-chat.ts`, `entry-chat-store.ts`, `account-store.ts` |
| Login continuation and protected destinations | `frontend/app/login/page.tsx`, `frontend/lib/account-route.ts`, `frontend/components/auth/role-guard.tsx` |
| Local owner consultation handoff | `frontend/components/chat/entry-owner-handoff.tsx`, existing `expert-handoff-block.tsx`, `frontend/lib/entry-chat-owner.ts`, `frontend/services/conversation.ts`, `frontend/lib/prototype/backend.ts` |

## Verification

Verified on 2026-10-02. Implementation checks supplied to the documentation finish:

- Full `npm test`: 56 tests passed. Coverage includes arbitrary input, draft/reload persistence, idempotent adoption, owner isolation, pending/retry behavior, late replies, storage failures, role-safe returns, and local owner handoff.
- Final `npm run build`: passed, with 52 static pages. Targeted ESLint passed for every touched TypeScript/TSX file. The final account-hydration cleanup also passed the two focused account-storage tests.
- Browser flows at 1440 × 900 and 390 × 844 covered guest entry, owner/expert/admin transitions, light/dark themes, keyboard interaction, protected routes, and consultation context. Conversation identity, messages, and draft survived login, cancellation, and reload with normal storage. Owner handoff created one local request; another owner could not access the conversation. Error, slow, and interrupted replies recovered without duplicating the user's message.
- Storage-denied browser checks preserved an interactive in-memory guest/chat experience and account login. A final fresh-context check with both normal storage and a throwing `localStorage` getter completed guest question → same conversation → owner login → same conversation with an enabled composer; no browser errors were reported. Reload persistence is not claimed when storage is denied.
- No external service requests were observed during the entry and role browser flows. The single Impeccable detector run returned `[]` with exit code 0.
- The independent review initially identified a P2 account-hydration failure when storage was blocked. Its final verdict was `ship`, with that specific finding scored resolved; the reviewer independently passed both account-storage tests. This verdict records the listed fix's resolution, not a new full-surface review.

Existing browser evidence is stored under `output/playwright/`:

| Evidence | Capture |
| --- | --- |
| [Guest landing, desktop](../output/playwright/entry-landing-desktop.png) | 1440 × 900 |
| [Guest landing, mobile](../output/playwright/entry-landing-mobile.png) | Full-page image, 390 × 973, from the 390 × 844 viewport |
| [Owner chat, desktop](../output/playwright/entry-owner-chat-desktop.png) | 1440 × 900 |
| [Expert transition, mobile](../output/playwright/entry-auditor2-mobile.png) | 390 × 844 |
| [Admin transition, mobile](../output/playwright/entry-admin-mobile.png) | 390 × 844 |
| [Error recovery, dark mobile](../output/playwright/entry-error-active-dark-mobile.png) | 390 × 844 |
| [Storage denied, mobile](../output/playwright/entry-storage-blocked-mobile.png) | 390 × 844 |

The documentation finish compared the approved contract, product constraints, incumbent design tokens and sidecar, luminous foundation styles, and the entry/chat/account source files. It checked the listed capture files and their dimensions and incorporated the implementation and independent-review results above; it did not repeat tests, the detector, or visual QA.

Limits: responses and consultation requests are local prototype examples centered on clinics. They do not call a real AI or provide substantive tax advice. Native mobile keyboards and assistive technology were not tested. Browser-local role separation is a prototype behavior, not a production authorization boundary.
