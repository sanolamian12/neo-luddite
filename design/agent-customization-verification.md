# Agent customization verification

Recorded 2026-10-01 for the primary `/audit/agents` workspace and preserved `/audit/agents/advanced` route. Product scope is defined in the [PRD](agent-customization-prd.md), interaction behavior in the [flows](agent-customization-flows.md), and composition in the [surface brief](agent-practice.md).

This record consolidates the delivery lead's completed command and browser checks, the independent review result, and the documenter's source comparison. It does not represent live model evaluation or production integration testing.

## Automated evidence

- All 33 frontend unit tests passed, including 13 new practice-domain tests in `frontend/lib/agent-practice.test.ts`.
- Domain coverage includes teaching validation and repeat application without duplicates; preservation of expert wording; exclusion of disabled, incomplete, and unrelated cases; priority among relevant cases; configured required questions; missing/conflicting-fact conclusion withholding; explicit human requests; unavailable-expert behavior; paused/resumed AI ownership; same-thread replies; and backward-compatible, per-expert storage. Clear and concise voice output is covered by domain tests.
- Changed-file ESLint passed. The production build completed all 47 static pages after the final source corrections. `git diff --check` was clean. No dependencies were added.

## Browser evidence

The lead exercised development and production builds in a real browser; final correction checks and all current captures use the production build. Primary captures use 1440 × 1000 desktop, 390 × 844 mobile, and 320 × 740 narrow mobile viewports; supplemental interaction checks used 1280px width.

- Teaching: required-field validation, draft save/reload, explicit application, and revision of applied knowledge. Knowledge: edits, relevant priority, disabled-case exclusion, and required questions in missing-facts rehearsal; missing and conflicting situations withheld the normal conclusion. Incomplete-case exclusion is domain-test evidence, not a separate browser action.
- Principles and rehearsal: principles editing/inspection, participation settings and availability, the common-AI-to-expert-service transition, and the separate direct-human request. Voice behavior is supported by the domain tests above; this is not a claim of independent browser coverage for every voice.
- Human participation: request context, takeover, a distinct direct-expert response, paused AI, explicit return, and resumed AI replies in the same thread. Unavailability retained the waiting request.
- Persistence and recovery: separate expert identities, new/copy/switch behavior without changing the original configuration, retained edits after storage quota failure, and corrupt JSON preserved until explicit recovery with Save locked beforehand.
- Layout and access: desktop/mobile, light/dark, reduced motion, the selected mobile knowledge editor visible in the viewport, and Enter activation of a task moving focus to its heading. No horizontal overflow was found at 320, 390, or 1280px.
- Final corrections: common-stage messages displayed `공통 AI`; expert-stage messages displayed `전문가의 AI`. All six mobile task options, the request shortcut, and its pending count were available at 390 and 320px. Programmatic task changes updated the selector.
- Browser checks reported no errors. Production emitted two unused CSS-preload warnings; the console was not warning-free.

## Independent finish review

The reviewer identified two scored corrections: the common AI had been labeled as the expert's AI, and mobile task navigation hid participation requests. Both were corrected. The final verdict explicitly returned `ship` for those two fixes, confirmed both resolved, and accepted all 14 refreshed captures as valid. This verdict is limited to those scored fixes; it is not a broad whole-surface pass.

The lead viewed all 14 captures. They remain local, ignored verification artifacts under `.impeccable/review/`, not shipped artwork:

| Surface | Capture filenames |
| --- | --- |
| Overview | `practice-desktop.png`, `practice-mobile.png`, `practice-320-dark.png` |
| Teaching | `practice-teaching-desktop.png`, `practice-teaching-mobile.png` |
| Knowledge | `practice-knowledge-desktop.png`, `practice-knowledge-mobile.png` |
| Expert AI rehearsal | `practice-preview-desktop.png`, `practice-preview-mobile-dark.png` |
| Common AI rehearsal | `practice-common-desktop.png`, `practice-common-mobile-dark.png` |
| Participation inbox | `practice-inbox-desktop.png`, `practice-inbox-mobile.png` |
| Principles | `practice-principles-desktop-dark.png` |

## Incumbent design system

`DESIGN.md` and `.impeccable/design.json` were preserved. Source comparison found all 49 recorded colors matched `frontend/components/design-system/luminous.css`; the sidecar remains schema version 2 with its 10 component previews. The primary surface reuses those palette/theme values, radii, shadows, Pretendard, and Lucide icons. Its local type sizes, native controls, breakpoints, and layout are documented as surface choices rather than added global tokens. The documenter also inspected the desktop overview and dark mobile common-AI captures.

The incumbent system prose still describes agent composition through the earlier Studio canvas. That surface description is stale for the primary route; the current practice and advanced-route briefs provide the route-specific truth. No unrelated system prose or tokens were rewritten, and no new rasters were introduced.

## Limits

Execution is deterministic and browser-local. There is no backend integration, live LLM, semantic RAG, model training, client-message delivery, or semantic enforcement of free-text policies. Demo identity separation is not a production access-control boundary. Advanced graph execution remains separate from knowledge rehearsal. These checks do not establish model accuracy, production security, screen-reader speech, or mobile Safari behavior.
