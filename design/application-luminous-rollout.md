# Application-wide luminous adoption

Mode: Operate. The user explicitly requested the approved luminous system across the whole application, following its expert-workspace introduction.

THESIS: One calm visual language follows a person from sign-in through customer conversations, expert work and administration.

OWN-WORLD: Inherit Pretendard, mist, teal ink, mint/sky washes, translucent navigation, near-opaque reading surfaces, 10px controls and 18px cards. Semantic feedback uses theme-aware foreground/background pairs. No new identity, raster assets or dependencies.

STORY: Sign in, navigate the appropriate role, complete existing tasks and inspect data without an abrupt change of visual language. Theme choice follows client navigation across all routes and portals; reload starts in light mode.

FIRST VIEWPORT: Public entry screens use the same luminous ground and solid controls as the workspaces. Each role has a translucent navigation rail/header, a clearly named workspace and access to the appearance toggle. Tables and forms keep their existing task hierarchy and receive readable controls, consistent surfaces and breathing room.

FORM: Code-led migration of the approved system and existing page structures. Preserve routing, permissions, data, forms and editing flows. The design-system specimen remains an independently themed reference. No concept tournament is required for this authorized system rollout.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Coverage and verification plan

- Move the luminous boundary to the document root so all pages and body portals inherit tokens; centralize theme state and role-shell styling.
- Migrate shared controls, cards, dialogs, menus and native data-table/form treatments. Replace fixed feedback colors with semantic token pairs.
- Apply the same entry-screen treatment to home, login and occupation selection. Preserve the expert practice/advanced Studio flow and extend the shell to remaining audit routes, customer screens and admin tools.
- Verify every static route by role and representative dynamic/detail routes with available local fixtures, plus desktop/mobile screenshots, theme continuity, dialogs/drawers, keyboard focus, reduced motion, login validation, consultation replay, forms and existing tests/build.
- Record unsupported prototype-service states separately from design regressions. Do not imply real backend writes or actual model execution.

## Verified implementation

- The root layout imports the foundation and application recipes, mounts `ApplicationThemeProvider`, and places `.luminous` on `html`. Customer, expert and admin layouts share `WorkspaceShell`. Public home, login, occupation selection and not-found screens use the same system.
- Shared buttons, inputs, textareas, cards, native form fields, tables, dialogs, account menus and mobile drawers inherit the foundation. Legacy feedback colors use semantic pairs; graph category hues retain their data meaning, with readable tinted labels.
- Production build and TypeScript pass. Existing tests: 47 passing. Targeted lint passes for the 18 foundation, shell, public-page, control and chat files checked together. The broader changed-file lint findings match HEAD exactly: 25 errors and 8 warnings in 19 legacy files; no new findings.
- Browser checks covered all 44 static page paths and 67 unique destinations including representative detail routes and missing-data/page states. Admin and expert sweeps produced no browser runtime errors, external data requests or page-level horizontal overflow. Desktop/mobile captures cover 1440, 390 and 320 pixels; representative overflow checks also cover 768 and 1024 pixels.
- Login error/success, mobile navigation dismissal, theme continuity through client navigation, chat replay/send, form selection/input, dark dialogs/menus, and Escape focus restoration were verified. KB empty/error/slow scenarios were exercised and restored to populated.
- Existing unsupported prototype-service responses remain visible where the local backend does not implement a legacy endpoint. Dynamic results/inspection/settlement states without populated fixtures inherit the system but were not verified as complete backend workflows.
- Local browser evidence and reports are under `.impeccable/review/application-*`; these generated artifacts are intentionally not committed.

## Finish review

The independent reviewer returned **ship** after inspecting all 25 supplied screenshots and sampling the shared implementation. No material fixes were requested. The verdict covers the captured public/customer/expert/admin surfaces and shared foundations; it is not a claim of exhaustive backend or legacy-source review.
