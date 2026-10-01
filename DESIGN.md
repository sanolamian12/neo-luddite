---
name: Neo-Luddite luminous system
description: An opt-in Korean workspace system with translucent layers, quiet depth, and purpose-specific cards.
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
  luminous-button-ghost:
    textColor: '{colors.luminous-ink}'
    rounded: '{rounded.luminous-control}'
    padding: 0 16px
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

The approved direction uses light, spacing, and information hierarchy to make an expert workspace feel airy and readable. Mist, mint, and sky sit behind translucent navigation, softly tinted summaries, and near-opaque reading surfaces. Locally loaded Korean Pretendard, Lucide line icons, restrained teal actions, and quiet offset shadows hold the system together.

This is an opt-in system, first implemented as the working `/design-system` specimen in the prototype. That route requires no login. `/audit/dashboard` and `/audit/agents` now adopt the same system, including their shared shell, mobile navigation drawer, and account menu. Other product routes retain their existing global tokens and role-colored navigation. The `--ds-*` tokens and shared-token aliases apply only inside `.luminous`; the frontmatter's `luminous-` prefix identifies this scope, and `luminous-dark-` records its dark overrides. This document does not redefine the application's global primary color.

**Key Characteristics:**

- Korean Pretendard with relaxed reading leading and tabular numbers.
- Solid, tinted, and glass materials, independent of tone and semantic status.
- Six card families structured around the information they hold.
- Light and dark themes, adjustable card padding, and visible keyboard focus.
- Code-built surfaces and icons; no raster assets.

Implementation sources: [luminous.css](frontend/components/design-system/luminous.css), [surface.tsx](frontend/components/design-system/surface.tsx), [controls.tsx](frontend/components/design-system/controls.tsx), and [cards.tsx](frontend/components/design-system/cards.tsx). The [specimen](frontend/components/design-system/specimen.tsx) and its [local styles](frontend/components/design-system/specimen.module.css) demonstrate composition and controls. Keep surface arrangements in the [specimen brief](design/luminous-system.md), [expert workspace brief](design/expert-workspace.md), and [Agent Studio brief](design/agent-studio.md). [AuditShell](frontend/components/layout/audit-shell.tsx) owns route scope and theme state; the incumbent [global stylesheet](frontend/app/globals.css) remains authoritative outside the luminous boundary.

The frontmatter records shipped token values; `.impeccable/design.json` adds metadata, depth, motion, scoped breakpoints, and self-contained component previews. There is no synthesized tonal ramp. Preview snippets illustrate appearance; React source owns application behavior.

## Colors

The light palette pairs cool mist and white with green-blue ink, teal actions, and low-chroma decorative fills. Dark mode uses deep blue-green surfaces, pale ink, and a lighter mint-teal action pair.

### Primary

- **Teal** (`--ds-accent`): primary actions, links, focus outlines, and workflow selection. `--ds-accent-hover` is a separate opaque hover color.
- **Primary foreground** (`--primary-foreground` inside `.luminous`): white in light mode and deep green in dark mode. Use the paired foreground with each theme's accent; do not carry white button text into the dark theme.

### Secondary

- **Mint, Sky, Amber** (`--ds-mint`, `--ds-sky`, `--ds-amber`): decorative surface tones and workspace atmosphere. They do not imply success, information, or warning.
- **Chart colors** (`--ds-chart-mint`, `--ds-chart-sky`, `--ds-chart-amber`): distribution segments and legend markers. These three values are inherited unchanged in dark mode; labels, counts, and percentages carry the data independently of color.
- **Status pairs** (`--ds-positive`, `--ds-info`, `--ds-warning`, `--ds-danger`, each with a `-bg` partner): success, information, warning, and failure. Neutral status uses muted ink on the canvas color. Each status retains explicit text.

### Neutral

- **Mist / Paper / Ink** (`--ds-canvas`, `--ds-paper`, `--ds-ink`): workspace background, opaque fallback, and primary content.
- **Muted ink** (`--ds-muted`): supporting text, labels, and secondary descriptions.
- **Divider / Field boundary** (`--ds-line`, `--ds-field-line`): quiet grouping and stronger interactive outlines respectively. The light field boundary is `#718d92`; do not substitute the faint divider for input edges.
- **Glass / Solid / Highlight** (`--ds-glass`, `--ds-solid`, `--ds-highlight`): translucent material, near-opaque material, and the fine inset top light. Their alpha values change with the theme.

**The Independent Axes Rule.** Material describes transparency, tone supplies atmosphere, and status communicates meaning. Select them independently; a mint card does not indicate completion.

**The Adoption Scope Rule.** Import the luminous foundations and opt a surface into `.luminous` deliberately. The specimen, expert dashboard, and Agent Studio are adopted; do not move aliases into `:root` or extend that scope to other routes implicitly.

Light tokens live on `.luminous`; `[data-theme="dark"]` on that same element overrides them. The shared-component bridge maps `--background`, `--foreground`, `--primary`, `--secondary`, `--muted`, `--card`, `--popover`, `--accent`, `--sidebar-*`, `--border`, `--input`, `--ring`, `--destructive`, and their relevant foregrounds to luminous values. These aliases introduce no new palette values. The local theme attribute does not set a global `.dark` class. The specimen's palette swatches intentionally remain the labeled light reference when the surrounding theme changes.

## Typography

**Display and body:** locally loaded Pretendard Variable through `--font-sans`. Preserve Korean word groups with `word-break: keep-all` in reading content, with overflow wrapping for evidence. Geist Mono is used for palette code labels only.

| Role | Implemented treatment | Purpose |
| --- | --- | --- |
| Display | `clamp(28px, 2.7vw, 32px)`, 600, 1.3 leading | Screen heading; specimen uses 28px at mobile width |
| Headline | 20px, 550, 1.5 leading | Section heading; specimen uses 19px at mobile width |
| Card title | 14px, 550, 1.6 leading | Quiet card label above its main information |
| Reading body | 15px, 400, 1.85 leading | Evidence and extended explanation; evidence measure is at most 65ch |
| Interface / supporting | 14px / 13px, 400, 1.6 leading | Controls, descriptions, and supporting information |
| Status label | 12px, 500, 1.5 leading | Short semantic labels |
| Value | `clamp(36px, 3.3vw, 48px)`, 550, 1.15 leading | Trend totals and state examples |
| Metric value | `clamp(44px, 4.2vw, 60px)`, 550, 1.15 leading | A single high-priority number |

Values use `font-variant-numeric: tabular-nums` and `-0.04em` tracking; units fall to 15px and regular tracking. Evidence titles use 21px/550 and expert names 20px/600. The hierarchy responds to the information type; it does not force all card content into one heading size.

## Layout

The spacing vocabulary is 4, 8, 12, 16, 20, 24, 32, and 48px. Comfortable surface padding is 24px; compact padding is 16px. `data-density` can set the inherited default on the luminous boundary or override an individual `Surface`. Density changes card padding, not font size, control height, or every page gap. Some specimen teaching panels explicitly override their padding.

Build grids around content needs and allow cards to shrink with `min-width: 0`. Maintain an uninterrupted reading measure and wrap control groups. The specimen demonstrates 32px wide-screen page gutters, 20px mobile gutters, and a 1330px maximum content width, but those dimensions and its unequal card grids are surface choices. Its responsive adjustments occur at 1240px, 1000px, and 700px, with additional top space at 1600px. These are recorded in the sidecar as specimen breakpoints, not required application-wide breakpoints.

The specimen navigation changes from a translucent side rail to a horizontal, locally scrollable section list at 1000px and below. At 700px and below, card and form demonstrations stack. Preserve the skip link, meaningful source order, and section anchors when composing another surface.

The adopted expert workspace uses a translucent application sidebar and header, with a mobile drawer. Dashboard summaries and actions use content-specific grids; Studio preserves its workflow canvas, instruction inspector, and test panel. Their dimensions and responsive transitions belong to their surface briefs rather than the global spacing scale.

## Elevation & Depth

Depth combines workspace-scale color washes, near-opaque reading surfaces, translucent tools, and quiet shadows. The atmosphere belongs to the shared workspace; a card's tint reinforces its information role.

- **Surface shadow** (`--ds-shadow`): `0 8px 30px -12px rgb(32 79 76 / 16%)` in light mode; the dark equivalent uses black at 38%. Surfaces pair this with `inset 0 1px 0 var(--ds-highlight)`.
- **Floating shadow** (`--ds-shadow-float`): `0 18px 48px -18px rgb(32 79 76 / 25%)` in light mode; the dark equivalent uses black at 48%. The workspace account menu and dashboard action-card hover use this token; specimen components do not consume it.
- **Solid:** `--ds-solid` is 94% white in light mode and 96% dark paper in dark mode. Evidence and editing use this near-opaque material.
- **Tinted:** a 125-degree gradient mixes the selected tone with paper at 70% and 90% tone. Setting tone alone does not tint a solid or glass surface.
- **Glass:** `--ds-glass` with an 18px backdrop blur; specimen navigation uses a 20px blur. Unsupported blur and reduced transparency switch these areas to opaque `--ds-paper`.

**The Reading Surface Rule.** Use near-opaque surfaces for long text and editing, and translucent material where it supports navigation or brief supporting content. Keep text contrast independent of decorative light.

Motion is limited to interaction feedback: 180ms ease-out for disclosure icons and workflow state, 160ms ease-out for navigation and the switch thumb, and 150ms ease-out for specimen choices. Shared button/input transitions remain inherited. Reduced motion removes transitions, animations, and smooth scrolling on each luminous root and its descendants, including portaled drawer and account-menu roots. The separate workspace drawer backdrop also removes its motion. Forced colors adds a visible surface border and a selected workflow outline.

## Shapes

Use 10px control corners, 18px card corners, and 24px panel corners. Status badges use 6px corners; topic tags use 5px. The expert's letter avatar has an asymmetric `20px 20px 20px 8px` silhouette. Preserve Lucide line icons and clear labels; the system does not require portrait imagery.

Default `Surface` cards have a top highlight and soft shadow without a hard outside border. Workflow cards use a 1px boundary; selection adds an inset 1px accent ring without changing their footprint. Form boundaries use the stronger field token. Keyboard focus uses a 2px accent outline offset by 4px, alongside any inherited shared-control focus ring.

## Components

### Surface and status primitives

`Surface` renders an `article` with `tone="neutral | mint | sky | amber"`, `material="solid | tinted | glass"`, and optional `density="comfortable | compact"`. Defaults are neutral, solid, and inherited density. `StatusBadge` accepts `tone="neutral | success | info | warning | danger"`; that API maps to `data-status`, not surface tone. `CardHeading` supplies a 14px title with optional trailing detail.

```tsx
import "@/components/design-system/luminous.css";
import { Surface, StatusBadge } from "@/components/design-system/surface";

<div className="luminous" data-theme="light" data-density="comfortable">
  <Surface material="tinted" tone="sky">
    <StatusBadge tone="warning">확인 필요</StatusBadge>
  </Surface>
</div>
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

These are reusable within the luminous boundary, with some deliberately specimen-specific wording and data assumptions: trend totals and breakdowns count consultations, and the profile/document cards describe fictional examples. Adapt those content contracts deliberately before connecting product data.

### Buttons and fields

Use `LuminousButton` from `controls.tsx` for the luminous control treatment. It wraps the existing shared Button, keeps its behavior, passes `data-variant`, and adds 40px minimum height, 16px horizontal padding, and 10px corners. Primary normal and hover backgrounds are opaque accent tokens. The demonstrated outline and ghost variants retain shared behavior through scoped aliases; disabled controls retain the shared opacity and disabled semantics. The wrapper still accepts shared variant and size props, but the specimen establishes the default, outline, ghost, and disabled treatments.

The specimen reuses shared `Input` with a local 44px minimum height, 15px text, 10px corners, 10px by 12px padding, paper background, and the stronger field boundary. Those dimensions are example-form styles, not a new exported luminous input component. Retain visible labels, described hints/errors, and `aria-invalid`. The name form applies trimmed content in component state, reports an empty value, and announces success; it does not save to a backend.

The demonstration switch is a native checkbox with `role="switch"`, a 42px by 26px track, a 20px thumb, and a visible focus outline on the track. Choice groups use labeled button groups and `aria-pressed`. Both switch and choices are local specimen controls rather than exported primitives.

Studio retains native buttons and form controls while applying the luminous accent, foreground, paper, field boundary, focus, and radius tokens. Its primary action groups and selects have a 40px minimum height. This preserves the existing editor behavior without introducing another shared input primitive.

### Navigation and data states

The specimen's section links pair Korean labels and Lucide icons, using mint fill and accent text on hover or focus. They navigate actual section anchors. No active-section tracking is implemented. Preserve native link behavior rather than presenting these links as application routing tabs.

`DataStateCard` demonstrates `ready`, `loading`, `empty`, and `error`. It preserves a 238px minimum height, uses a static skeleton plus loading text and `aria-busy`, explains an empty result, and supplies an error retry callback. The specimen's retry returns to ready example data immediately. Theme, density, choices, selected stage, and form values are local component state; the specimen does not persist them or call services.

The audit layout retains its theme value during client navigation and applies it only on the two adopted routes. Reload starts in light mode. The optional React theme context passes that value to the mobile drawer and account menu, whose portal roots receive their own luminous boundary. Other audit routes keep their existing styling.

The dashboard composes `MetricCard`, `Surface`, `StatusBadge`, and `LuminousButton` around account-filtered store data. When accepted plus rejected results total zero, the acceptance rate is an unmeasured dash with explanatory text. Temporary ledger fixtures used in browser review are not bundled records. Studio saves configurations in browser-local storage and runs deterministic simulations; neither behavior implies live model execution.

## Do's and Don'ts

### Do:

- **Do** apply the system inside an explicit `.luminous` boundary and use the local theme attribute for its light/dark pair.
- **Do** choose material, decorative tone, and semantic status independently.
- **Do** select a card structure that matches its information, preserving readable evidence and numeric labels.
- **Do** use `LuminousButton` for opaque primary hover behavior and retain the stronger field boundary.
- **Do** preserve Korean Pretendard, visible labels, keyboard focus, and reduced motion/transparency fallbacks.
- **Do** keep example counts, documents, profiles, execution states, and confidence distinct from real product data.

### Don't:

- **Don't** rewrite root tokens or treat routes beyond the specimen, expert dashboard, and Agent Studio as already migrated.
- **Don't** equate a mint, sky, or amber surface with a semantic status.
- **Don't** force the specimen's rail, unequal grids, or teaching-panel layout onto every future screen.
- **Don't** rely on color, translucent layers, chart shapes, or icons alone to communicate meaning.
- **Don't** imply that the specimen saves settings, sends notifications, or runs a live agent.
- **Don't** treat verification screenshots as shipped artwork or invented tonal ramps as available tokens.
