# Luminous design system specimen

Mode: Operate. Route: `/design-system` (prototype only, no login required).

The user approved a luminous direction with translucent layers, gentle gradients,
more depth, generous spacing, Pretendard typography, and purpose-specific cards.
The first deliverable was a working specimen. `/audit/dashboard`, `/audit/agents`,
and their shared shell now adopt it; other product routes retain their existing styling.
All specimen people, evidence excerpts, activity counts, and charts are labeled examples.

## Direction contract

THESIS: Make light, spacing, and information hierarchy the common language of the expert workspace. Cards have different structures for metrics, trends, breakdowns, sources, people, and workflow stages.

OWN-WORLD: Mist #F3F7F8, white #FFFFFF, ink #19343A, teal #176B64, mint #DCEFE6, and sky #DEECF8. Pretendard, 10px controls, 18px cards, translucent navigation, quiet offset shadows, and near-opaque reading surfaces. Appearance, density, and status are separate.

STORY: A designer or developer can inspect the system in Korean, switch theme and density, expand evidence, inspect chart values, select a workflow stage, and exercise empty/loading/error states without changing product data.

FIRST VIEWPORT: A narrow translucent navigation rail frames a spacious heading and three unequal data compositions. The next row introduces a reading surface and an expert profile. The atmosphere spans the workspace rather than decorating each card independently.

FORM: A code-led system specimen in the user-approved visual direction. Palette, surface, typography, and control references follow realistic card examples. No concept tournament is needed for this agreed deliverable.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Boundaries and verification

- Tokens remain scoped to `.luminous`. At the initial specimen delivery, existing product screens retained their rendering; current dashboard/Studio adoption is recorded in [the expert workspace brief](expert-workspace.md).
- Reuse Pretendard, Lucide, shared Button/Input, and the existing Sparkline. No new dependencies or raster assets.
- Test desktop and mobile, both themes, density, keyboard focus, data states, disclosure controls, and the contact-free sample form.
- Reduced motion removes transitions; reduced transparency and unsupported blur use solid fallback surfaces.
- Keep demonstration confidence separate from measured model accuracy. No specimen figures claim real product performance.

## Initial specimen verification (2026-10-01)

- Existing frontend suite: 20 tests passed. Targeted ESLint and production build
  (including TypeScript) passed after the contrast corrections.
- Chromium: light/dark desktop and mobile captures; no page overflow at widths
  320, 390, 768, 1024, and 1440px (dark additionally checked at 320px).
- Period totals and accessible chart tables, density, evidence/profile disclosures,
  workflow selection, form validation/confirmation, switch, loading/empty/error/retry,
  keyboard activation/focus, and reduced motion verified in-browser.
- Production navigation from login to specimen and back passed without runtime
  errors; at this initial delivery, the luminous theme was scoped to the specimen.
- The design detector returned no findings. Independent review identified light
  control-boundary and primary-hover contrast gaps. The corrected boundary is
  #718D92 (3.54:1 against white, 3.28:1 against mist); primary hover now uses
  opaque tokens (8.87:1 light and 9.30:1 dark). Browser-computed colors confirm
  the new values reach the controls.
- The independent verdict pass scored both contrast fixes resolved and returned
  `ship` for that fix batch. Final captures use the production build.
- Screen-reader speech and mobile Safari have not been tested.
