---
name: Neo-Luddite luminous system
description: The application-wide Korean workspace system with translucent layers, quiet depth, and purpose-specific cards.
colors:
  luminous-canvas: '#f3f7f8'
  luminous-paper: '#fff'
  luminous-ink: '#19343a'
  luminous-muted: '#526b70'
  luminous-accent: '#176b64'
  luminous-accent-hover: '#10534d'
  luminous-mint: '#dcefe6'
  luminous-sky: '#deecf8'
  luminous-amber: '#f7ead5'
  luminous-line: '#d2dfe0'
  luminous-field-line: '#718d92'
  luminous-glass: rgb(255 255 255 / 64%)
  luminous-solid: rgb(255 255 255 / 94%)
  luminous-highlight: rgb(255 255 255 / 88%)
  luminous-positive: '#23654b'
  luminous-positive-bg: '#e0efe5'
  luminous-info: '#285e84'
  luminous-info-bg: '#e5eff8'
  luminous-warning: '#78531a'
  luminous-warning-bg: '#f9edd6'
  luminous-danger: '#a13935'
  luminous-danger-bg: '#f9e7e4'
  luminous-chart-mint: '#559c88'
  luminous-chart-sky: '#76a9ce'
  luminous-chart-amber: '#d7b574'
  luminous-primary-foreground: '#fff'
  luminous-dark-canvas: '#122429'
  luminous-dark-paper: '#1c3338'
  luminous-dark-ink: '#e5f1ed'
  luminous-dark-muted: '#abc3c5'
  luminous-dark-accent: '#99d9c8'
  luminous-dark-accent-hover: '#b9edde'
  luminous-dark-mint: '#23473e'
  luminous-dark-sky: '#243f54'
  luminous-dark-amber: '#493f2b'
  luminous-dark-line: '#3e595c'
  luminous-dark-field-line: '#68898c'
  luminous-dark-glass: rgb(24 46 51 / 78%)
  luminous-dark-solid: rgb(28 51 56 / 96%)
  luminous-dark-highlight: rgb(215 248 242 / 11%)
  luminous-dark-positive: '#b1e4c8'
  luminous-dark-positive-bg: '#25483c'
  luminous-dark-info: '#b4d8f5'
  luminous-dark-info-bg: '#294457'
  luminous-dark-warning: '#f0d294'
  luminous-dark-warning-bg: '#493f2b'
  luminous-dark-danger: '#ffb7ac'
  luminous-dark-danger-bg: '#4d3433'
  luminous-dark-primary-foreground: '#123d35'
typography:
  luminous-page-title:
    fontFamily: var(--font-sans)
    fontSize: 28px
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: -0.03em
  luminous-public-display:
    fontFamily: var(--font-sans)
    fontSize: clamp(36px, 5vw, 64px)
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.04em
  luminous-display:
    fontFamily: var(--font-sans)
    fontSize: clamp(28px, 2.7vw, 32px)
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: -0.035em
  luminous-headline:
    fontFamily: var(--font-sans)
    fontSize: 20px
    fontWeight: 550
    lineHeight: 1.5
    letterSpacing: -0.025em
  luminous-title:
    fontFamily: var(--font-sans)
    fontSize: 14px
    fontWeight: 550
    lineHeight: 1.6
  luminous-body:
    fontFamily: var(--font-sans)
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.85
  luminous-interface:
    fontFamily: var(--font-sans)
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.6
  luminous-supporting:
    fontFamily: var(--font-sans)
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.6
  luminous-label:
    fontFamily: var(--font-sans)
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.5
  luminous-value:
    fontFamily: var(--font-sans)
    fontSize: clamp(36px, 3.3vw, 48px)
    fontWeight: 550
    lineHeight: 1.15
    letterSpacing: -0.04em
  luminous-metric:
    fontFamily: var(--font-sans)
    fontSize: clamp(44px, 4.2vw, 60px)
    fontWeight: 550
    lineHeight: 1.15
    letterSpacing: -0.04em
rounded:
  luminous-control: 10px
  luminous-card: 18px
  luminous-panel: 24px
  luminous-status: 6px
  luminous-tag: 5px
spacing:
  luminous-1: 4px
  luminous-2: 8px
  luminous-3: 12px
  luminous-4: 16px
  luminous-5: 20px
  luminous-6: 24px
  luminous-8: 32px
  luminous-12: 48px
components:
  luminous-button-primary:
    backgroundColor: '{colors.luminous-accent}'
    textColor: '{colors.luminous-primary-foreground}'
    rounded: '{rounded.luminous-control}'
    padding: 0 16px
    height: 40px
  luminous-button-primary-hover:
    backgroundColor: '{colors.luminous-accent-hover}'
    textColor: '{colors.luminous-primary-foreground}'
  luminous-button-primary-dark:
    backgroundColor: '{colors.luminous-dark-accent}'
    textColor: '{colors.luminous-dark-primary-foreground}'
  luminous-button-primary-dark-hover:
    backgroundColor: '{colors.luminous-dark-accent-hover}'
    textColor: '{colors.luminous-dark-primary-foreground}'
  luminous-button-outline:
    backgroundColor: '{colors.luminous-paper}'
    textColor: '{colors.luminous-ink}'
    rounded: '{rounded.luminous-control}'
    padding: 0 16px
    height: 40px
  luminous-button-ghost:
    textColor: '{colors.luminous-ink}'
    rounded: '{rounded.luminous-control}'
    padding: 0 16px
    height: 40px
  luminous-input:
    backgroundColor: '{colors.luminous-paper}'
    textColor: '{colors.luminous-ink}'
    rounded: '{rounded.luminous-control}'
    padding: 4px 12px
    height: 40px
  luminous-textarea:
    backgroundColor: '{colors.luminous-paper}'
    textColor: '{colors.luminous-ink}'
    rounded: '{rounded.luminous-control}'
    padding: 8px 12px
  luminous-card:
    backgroundColor: '{colors.luminous-paper}'
    textColor: '{colors.luminous-ink}'
    rounded: '{rounded.luminous-card}'
  luminous-dialog:
    backgroundColor: '{colors.luminous-paper}'
    textColor: '{colors.luminous-ink}'
    rounded: '{rounded.luminous-panel}'
  luminous-input-example:
    backgroundColor: '{colors.luminous-paper}'
    textColor: '{colors.luminous-ink}'
    rounded: '{rounded.luminous-control}'
    padding: 10px 12px
  luminous-surface-solid:
    backgroundColor: '{colors.luminous-solid}'
    textColor: '{colors.luminous-ink}'
    rounded: '{rounded.luminous-card}'
    padding: '{spacing.luminous-6}'
  luminous-surface-glass:
    backgroundColor: '{colors.luminous-glass}'
    textColor: '{colors.luminous-ink}'
    rounded: '{rounded.luminous-card}'
    padding: '{spacing.luminous-6}'
  luminous-surface-compact:
    rounded: '{rounded.luminous-card}'
    padding: '{spacing.luminous-4}'
  luminous-status-success:
    backgroundColor: '{colors.luminous-positive-bg}'
    textColor: '{colors.luminous-positive}'
    rounded: '{rounded.luminous-status}'
    padding: 4px 9px
    typography: '{typography.luminous-label}'
  luminous-navigation-link:
    textColor: '{colors.luminous-muted}'
    rounded: '{rounded.luminous-control}'
    padding: 12px 10px
  luminous-workflow-selected:
    backgroundColor: color-mix(in srgb, var(--ds-mint) 58%, var(--ds-paper))
    textColor: '{colors.luminous-ink}'
    rounded: '{rounded.luminous-card}'
    padding: '{spacing.luminous-6}'
---

# Design System: Neo-Luddite luminous system

## Overview

**Creative North Star: "빛과 여백의 워크스페이스 — Luminous workspace"**

The approved direction uses light, spacing, and information hierarchy to make public entry screens and customer, expert, and administration workspaces feel airy and readable. Mist, mint, and sky sit behind translucent navigation, softly tinted summaries, and near-opaque reading surfaces. Locally loaded Korean Pretendard, Lucide line icons, restrained teal actions, and quiet diffuse shadows hold the system together.

This is the application-wide system. The root layout imports the luminous foundations and application recipes, places `.luminous` on `html`, and mounts `ApplicationThemeProvider`. Public home, login, occupation selection, and not-found screens, all role workspaces, and body portals inherit the same `--ds-*` tokens and shared-component aliases. The frontmatter's `luminous-` prefix names these foundations; `luminous-dark-` records their dark overrides. The public `/design-system` specimen remains an independently themed reference within that global boundary.

**Key Characteristics:**

- Korean Pretendard with relaxed reading leading and tabular numbers.
- Solid, tinted, and glass materials, independent of tone and semantic status.
- Shared controls and role navigation, with six card families structured around the information they hold.
- Application-wide light and dark themes, adjustable Surface padding, and visible keyboard focus.
- Code-built surfaces and icons; no raster assets.

Implementation sources: [root layout](frontend/app/layout.tsx), [global aliases](frontend/app/globals.css), [luminous.css](frontend/components/design-system/luminous.css), [application.css](frontend/components/design-system/application.css), [theme provider](frontend/components/design-system/theme.tsx), [WorkspaceShell](frontend/components/layout/workspace-shell.tsx), and [PublicHeader](frontend/components/layout/public-header.tsx). Shared [Button](frontend/components/ui/button.tsx), [Card](frontend/components/ui/card.tsx), [Input](frontend/components/ui/input.tsx), and [Textarea](frontend/components/ui/textarea.tsx) consume the same foundation. [Surface](frontend/components/design-system/surface.tsx), [controls](frontend/components/design-system/controls.tsx), and [card families](frontend/components/design-system/cards.tsx) remain reusable. The [specimen](frontend/components/design-system/specimen.tsx) and its [local styles](frontend/components/design-system/specimen.module.css) demonstrate composition and controls. Keep surface arrangements in the [specimen brief](design/luminous-system.md), [expert workspace brief](design/expert-workspace.md), and [Agent Studio brief](design/agent-studio.md); the [application rollout brief](design/application-luminous-rollout.md) records migration coverage, verification evidence, and limits.

The frontmatter records shipped token values; `.impeccable/design.json` adds metadata, depth, motion, scoped breakpoints, and self-contained component previews. There is no synthesized tonal ramp. Preview snippets illustrate appearance; React source owns application behavior.

## Colors

The light palette pairs cool mist and white with green-blue ink, teal actions, and low-chroma decorative fills. Dark mode uses deep blue-green surfaces, pale ink, and a lighter mint-teal action pair.

### Primary

- **Teal** (`--ds-accent`): primary actions, links, focus outlines, and workflow selection. `--ds-accent-hover` is a separate opaque hover color.
- **Primary foreground** (`--primary-foreground`): white in light mode and deep green in dark mode. Use the paired foreground with each theme's accent; do not carry white button text into the dark theme.

### Secondary

- **Mint, Sky, Amber** (`--ds-mint`, `--ds-sky`, `--ds-amber`): decorative surface tones and workspace atmosphere. They do not imply success, information, or warning.
- **Chart colors** (`--ds-chart-mint`, `--ds-chart-sky`, `--ds-chart-amber`): distribution segments and legend markers. These three values are inherited unchanged in dark mode; labels, counts, and percentages carry the data independently of color.
- **Status pairs** (`--ds-positive`, `--ds-info`, `--ds-warning`, `--ds-danger`, each with a `-bg` partner): success, information, warning, and failure. Neutral status uses muted ink on the canvas color. Each status retains explicit text. Application utilities expose `text-success` / `bg-success-soft`, `text-info` / `bg-info-soft`, `text-warning` / `bg-warning-soft`, and `text-destructive` / `bg-danger-soft`; `text-on-accent` uses the paired primary foreground. Graph category hues retain their data meaning rather than becoming status colors.

### Neutral

- **Mist / Paper / Ink** (`--ds-canvas`, `--ds-paper`, `--ds-ink`): workspace background, opaque fallback, and primary content.
- **Muted ink** (`--ds-muted`): supporting text, labels, and secondary descriptions.
- **Divider / Field boundary** (`--ds-line`, `--ds-field-line`): quiet grouping and stronger interactive outlines respectively. The light field boundary is `#718d92`; do not substitute the faint divider for input edges.
- **Glass / Solid / Highlight** (`--ds-glass`, `--ds-solid`, `--ds-highlight`): translucent material, near-opaque material, and the fine inset top light. Their alpha values change with the theme.

**The Independent Axes Rule.** Material describes transparency, tone supplies atmosphere, and status communicates meaning. Select them independently; a mint card does not indicate completion.

**The Shared Foundation Rule.** The document root owns the luminous boundary and application theme. Reuse its aliases across public pages, role workspaces, and portals; keep role and workflow structure in the relevant surface components.

Light tokens live on `.luminous`; `[data-theme="dark"]` on that same element overrides them. `ApplicationThemeProvider` updates both `html[data-theme]` and the global `.dark` class so CSS variables and Tailwind dark variants follow one theme. The shared-component bridge maps `--background`, `--foreground`, `--primary`, `--secondary`, `--muted`, `--card`, `--popover`, `--accent`, `--sidebar-*`, `--border`, `--input`, `--ring`, `--destructive`, `--brand-*`, `--chart-*`, and their relevant foregrounds to luminous values; `--radius` maps to the control radius. These aliases introduce no new palette values. A nested `.luminous[data-theme]` still provides local tokens for the specimen without taking ownership of the document theme. Its palette swatches intentionally remain the labeled light reference when the surrounding theme changes.

## Typography

**Display and body:** locally loaded Pretendard Variable through `--font-sans`. Preserve Korean word groups with `word-break: keep-all` in reading content, with overflow wrapping for evidence. Geist Mono is available through `--font-mono`, including specimen palette code labels. The root keeps `1rem = 16px`; body and nested luminous interface text use 14px with 1.6 leading. Do not reduce the root font size to obtain compact controls.

| Role | Implemented treatment | Purpose |
| --- | --- | --- |
| Application page title | 28px, 650, 1.35 leading | `.ds-page` header; 24px at 640px and below |
| Public display | `clamp(36px, 5vw, 64px)`, 600, 1.2 leading | Home headline |
| Specimen display | `clamp(28px, 2.7vw, 32px)`, 600, 1.3 leading | Specimen heading; 28px at mobile width |
| Headline | 20px, 550, 1.5 leading | Section heading; specimen uses 19px at mobile width |
| Card title | 14px, 550, 1.6 leading | Quiet card label above its main information |
| Reading body | 15px, 400, 1.85 leading | Evidence and extended explanation; evidence measure is at most 65ch |
| Interface / supporting | 14px / 13px, 400, 1.6 leading | Controls, descriptions, and supporting information |
| Status label | 12px, 500, 1.5 leading | Short semantic labels |
| Value | `clamp(36px, 3.3vw, 48px)`, 550, 1.15 leading | Trend totals and state examples |
| Metric value | `clamp(44px, 4.2vw, 60px)`, 550, 1.15 leading | A single high-priority number |

Values use `font-variant-numeric: tabular-nums` and `-0.04em` tracking; units fall to 15px and regular tracking. Evidence titles use 21px/550 and expert names 20px/600. The hierarchy responds to the information type; it does not force all card content into one heading size.

## Layout

The spacing vocabulary is 4, 8, 12, 16, 20, 24, 32, and 48px. The shared `.ds-page` recipe uses 32px padding on desktop and 24px vertically by 16px horizontally at 640px and below. `.ds-panel` uses the 18px card radius, with header padding of 20px by 24px, reduced to 16px on mobile. Comfortable surface padding is 24px; compact padding is 16px. `data-density` can set the inherited default on the luminous boundary or override an individual `Surface`. Density changes card padding, not font size, control height, or every page gap. Some specimen teaching panels explicitly override their padding.

Build grids around content needs and allow cards to shrink with `min-width: 0`. Maintain an uninterrupted reading measure and wrap control groups. The specimen demonstrates 32px wide-screen page gutters, 20px mobile gutters, and a 1330px maximum content width, but those dimensions and its unequal card grids are surface choices. Its responsive adjustments occur at 1240px, 1000px, and 700px, with additional top space at 1600px. These are recorded in the sidecar as specimen breakpoints, not required application-wide breakpoints.

The specimen navigation changes from a translucent side rail to a horizontal, locally scrollable section list at 1000px and below. At 700px and below, card and form demonstrations stack. Preserve the skip link, meaningful source order, and section anchors when composing another surface.

`WorkspaceShell` supplies the customer, expert, and admin layouts with a translucent sidebar and header, role-specific labels and navigation, a mobile drawer, and a shared theme toggle. Its desktop sidebar is 15rem (240px); its header is 64px tall, reduced to 56px at 640px and below. The sidebar switches to its mobile drawer below 768px. Role routes retain their tables, queues, conversations, forms, and editors. Dashboard summaries use content-specific grids; Studio preserves its workflow canvas, instruction inspector, and test panel.

Public routes reuse `PublicHeader` and the same canvas. Home centers its headline and action; login uses a two-column layout until 900px, then presents a single form column. Login forms and dialogs use the 24px panel radius. Occupation selection retains its choice grid, and not-found uses the same centered landing treatment as home, directly on the canvas. These compositions and the specimen's teaching layout are surface recipes, not mandatory templates for every page.

## Elevation & Depth

Depth combines workspace-scale color washes, near-opaque reading surfaces, translucent tools, and quiet shadows. The atmosphere belongs to the shared workspace; a card's tint reinforces its information role.

- **Surface shadow** (`--ds-shadow`): `0 8px 30px -12px rgb(32 79 76 / 16%)` in light mode; the dark equivalent uses black at 38%. Surfaces pair this with `inset 0 1px 0 var(--ds-highlight)`.
- **Floating shadow** (`--ds-shadow-float`): `0 18px 48px -18px rgb(32 79 76 / 25%)` in light mode; the dark equivalent uses black at 48%. Dialogs, workspace account menus, public choice hover, and dashboard action-card hover use this token; specimen components do not consume it.
- **Solid:** `--ds-solid` is 94% white in light mode and 96% dark paper in dark mode. Evidence and editing use this near-opaque material.
- **Tinted:** a 125-degree gradient mixes the selected tone with paper at 70% and 90% tone. Setting tone alone does not tint a solid or glass surface.
- **Glass:** `--ds-glass` with an 18px backdrop blur on `Surface`, 16px on shared workspace chrome, and 20px on specimen navigation. Unsupported blur and reduced transparency switch these areas to opaque `--ds-paper`.

**The Reading Surface Rule.** Use near-opaque surfaces for long text and editing, and translucent material where it supports navigation or brief supporting content. Keep text contrast independent of decorative light.

Motion supports interaction feedback: 180ms ease-out for disclosure icons and workflow state, 160ms ease-out for specimen navigation and the switch thumb, and 150ms ease-out for specimen choices. Public choice hover uses a 160ms shadow transition; shared button/input transitions remain inherited. CSS reduced-motion rules suppress CSS animations, transitions, and smooth scrolling throughout the document boundary, including portals. `MotionConfig reducedMotion="user"` respects the preference for Motion transform animations; it does not remove staged chat reveal timers or every opacity effect. Forced colors adds visible surface borders and a selected workflow outline.

## Shapes

Use 10px default control corners, 18px card and `.ds-panel` corners, and 24px dialog/public-form corners. Explicit small Button variants retain their compact radii and dimensions. Status badges use 6px corners; topic tags use 5px. The specimen expert's letter avatar has an asymmetric `20px 20px 20px 8px` silhouette; shared application avatars remain circular, with foreground-colored fallback initials. Preserve Lucide line icons and clear labels; the system does not require portrait imagery.

Default `Surface` cards have a top highlight and soft shadow without a hard outside border. Workflow cards use a 1px boundary; selection adds an inset 1px accent ring without changing their footprint. Form boundaries use the stronger field token. Keyboard focus uses a 2px accent outline offset by 4px, alongside any inherited shared-control focus ring.

## Components

### Surface and status primitives

`Surface` renders an `article` with `tone="neutral | mint | sky | amber"`, `material="solid | tinted | glass"`, and optional `density="comfortable | compact"`. Defaults are neutral, solid, and inherited density. `StatusBadge` accepts `tone="neutral | success | info | warning | danger"`; that API maps to `data-status`, not surface tone. `CardHeading` supplies a 14px title with optional trailing detail.

```tsx
import { Surface, StatusBadge } from "@/components/design-system/surface";

// The root layout already loads the foundation and owns the theme.
<Surface material="tinted" tone="sky" density="comfortable">
  <StatusBadge tone="warning">확인 필요</StatusBadge>
</Surface>
```

### Six card families

| Component | Structure and behavior |
| --- | --- |
| `MetricCard` | A dominant value and unit, quiet description, optional footer; mint tinted material by default. |
| `TrendCard` | Total, comparison, period, and the existing Sparkline on a sky tint. Native disclosure exposes a captioned data table; fewer than two points show an explanatory message. |
| `BreakdownCard` | Summary, proportional strip, and a legend with names, counts, and percentages on solid material. A zero total has an explicit empty explanation. |
| `EvidenceCard` | Source and status, title, readable excerpt, and an expandable context section on solid material. The current implementation explicitly labels its document as fictional. |
| `ExpertCard` | Initial avatar, name, specialty, topic tags, availability, and a profile disclosure on glass. Current occupation, profile details, and availability are specimen examples. |
| `WorkflowCard` | A full-width button with step number, status, role icon, title, and description. `aria-pressed` expresses selection; `complete`, `active`, and `waiting` are independent execution states. |

These are reusable across the application, with some deliberately specimen-specific wording and data assumptions: trend totals and breakdowns count consultations, and the profile/document cards describe fictional examples. Adapt those content contracts deliberately before connecting product data.

### Buttons and fields

Shared `Button` is the default application control: 40px height, 16px horizontal padding, 14px text, and 10px corners. Primary normal and hover backgrounds use opaque accent tokens with the paired foreground. Outline uses paper and the stronger field boundary; ghost stays transparent until hover. Secondary, destructive, and link variants retain their shared behavior through theme aliases. Small variants intentionally remain compact: `xs` is 28px, `sm` is 32px, and `lg` is 44px; icon variants have their own sizes. Disabled controls retain shared opacity and disabled semantics. `LuminousButton` remains a compatible wrapper that applies a 40px minimum height and 16px padding to its variants.

Shared `Input` uses 40px height, 10px corners, 4px by 12px padding, opaque paper, and the stronger field boundary. `Textarea` shares that material and boundary, with a 64px minimum height and 8px by 12px padding. Their text is 16px below the `md` breakpoint and 14px from 768px. Native selects receive a 40px minimum height, paper fill, and 8px by 12px padding. Invalid input, textarea, and select boundaries use the danger token; shared fields also retain focus/error rings and disabled treatments.

The specimen reuses shared `Input` with a local 44px minimum height, 15px text, 10px corners, 10px by 12px padding, paper background, and the stronger field boundary. Those dimensions are example-form styles, not a new exported luminous input component. Retain visible labels, described hints/errors, and `aria-invalid`. The name form applies trimmed content in component state, reports an empty value, and announces success; it does not save to a backend.

The demonstration switch is a native checkbox with `role="switch"`, a 42px by 26px track, a 20px thumb, and a visible focus outline on the track. Choice groups use labeled button groups and `aria-pressed`. Both switch and choices are local specimen controls rather than exported primitives.

Studio retains native buttons and form controls while applying the luminous accent, foreground, paper, field boundary, focus, and radius tokens. Its primary action groups and selects have a 40px minimum height. This preserves the existing editor behavior without introducing another shared input primitive.

### Application containers and tables

Shared `Card` uses opaque paper, the 18px card radius, and the surface shadow. Its content spacing is 24px by default and 16px for `size="sm"`; this component uses its own size API rather than `Surface` density. `.ds-panel` and public forms use near-opaque solid material and the inset top highlight. Dialogs use opaque paper, 24px corners, and the floating shadow. Keep extended reading and editing on these stable surfaces.

The application table recipe gives headers muted ink on the canvas, 12px semibold labels, tabular numbers, 12px vertical cell padding, and a faint mint row hover. Explicit component styles can preserve a denser specialized table, such as the specimen's data disclosure. Menus and drawers inherit document tokens; mobile navigation is opaque paper for readability.

### Navigation and data states

The specimen's section links pair Korean labels and Lucide icons, using mint fill and accent text on hover or focus. They navigate actual section anchors. No active-section tracking is implemented. Preserve native link behavior rather than presenting these links as application routing tabs.

`DataStateCard` demonstrates `ready`, `loading`, `empty`, and `error`. It preserves a 238px minimum height, uses a static skeleton plus loading text and `aria-busy`, explains an empty result, and supplies an error retry callback. The specimen's retry returns to ready example data immediately. Theme, density, choices, selected stage, and form values are local component state; the specimen does not persist them or call services.

`ApplicationThemeProvider` retains the theme during client navigation across public pages and role layouts. Reload starts in light mode; no stored preference or automatic system-theme selection is implemented. `ThemeToggle` in `WorkspaceShell` and `PublicHeader` changes that shared state and labels the action for the destination theme. Body portals inherit the document tokens, while the theme context remains available to components that need the current value. The specimen owns a separate local theme for its demonstrations.

The dashboard composes `MetricCard`, `Surface`, `StatusBadge`, and `LuminousButton` around account-filtered store data. When accepted plus rejected results total zero, the acceptance rate is an unmeasured dash with explanatory text. Temporary ledger fixtures used in browser review are not bundled records. Studio saves configurations in browser-local storage and runs deterministic simulations; neither behavior implies live model execution.

## Do's and Don'ts

### Do:

- **Do** inherit the root luminous tokens and application theme across routes and portals; reserve nested theme boundaries for independent demonstrations.
- **Do** choose material, decorative tone, and semantic status independently.
- **Do** select a card structure that matches its information, preserving readable evidence and numeric labels.
- **Do** use shared controls and semantic status pairs, preserving opaque primary hover behavior and the stronger field boundary.
- **Do** preserve Korean Pretendard, visible labels, keyboard focus, and reduced motion/transparency fallbacks.
- **Do** keep example counts, documents, profiles, execution states, and confidence distinct from real product data.

### Don't:

- **Don't** reintroduce role-specific palettes or local route theme ownership into the shared application shell.
- **Don't** equate a mint, sky, or amber surface with a semantic status.
- **Don't** force the specimen's rail, unequal grids, or teaching-panel layout onto every future screen.
- **Don't** rely on color, translucent layers, chart shapes, or icons alone to communicate meaning.
- **Don't** imply that the specimen saves settings, sends notifications, or runs a live agent.
- **Don't** treat verification screenshots as shipped artwork or invented tonal ramps as available tokens.
