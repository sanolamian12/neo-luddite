---
name: Neo-Luddite expert workspace
description: Existing Korean expert workspace with role-colored navigation and restrained working surfaces.
colors:
  primary: "oklch(0.54 0.13 238)"
  primary-foreground: "oklch(0.985 0 0)"
  background: "oklch(1 0 0)"
  foreground: "oklch(0.145 0 0)"
  muted: "oklch(0.97 0 0)"
  muted-foreground: "oklch(0.556 0 0)"
  border: "oklch(0.922 0 0)"
  brand-blue: "oklch(0.6 0.13 236)"
  brand-green: "oklch(0.8 0.15 162)"
  brand-amber: "oklch(0.78 0.16 70)"
  auditor-sidebar: "oklch(0.33 0.06 165)"
  auditor-sidebar-foreground: "oklch(0.97 0.02 165)"
  auditor-sidebar-accent: "oklch(0.42 0.08 165)"
  auditor-sidebar-accent-foreground: "oklch(0.98 0.02 165)"
  studio-green: "#21634d"
  studio-ink: "#20342c"
  studio-muted: "#586b62"
  studio-line: "#dce4df"
  studio-canvas: "#f5f8f5"
  studio-field-line: "#c8d4cc"
  studio-active: "#e6f3e9"
  studio-handoff: "#fcf4e7"
  studio-handoff-ink: "#72501e"
typography:
  display:
    fontFamily: "var(--font-sans)"
    fontSize: "2.25rem"
    fontWeight: 700
    letterSpacing: "-0.025em"
  title:
    fontFamily: "var(--font-sans)"
    fontSize: "1rem"
    fontWeight: 500
  body:
    fontFamily: "var(--font-sans)"
    fontSize: "14px"
  studio-headline:
    fontFamily: "var(--font-sans)"
    fontSize: "21px"
    fontWeight: 700
    letterSpacing: "-0.025em"
  studio-section:
    fontFamily: "var(--font-sans)"
    fontSize: "14px"
    fontWeight: 650
  studio-label:
    fontFamily: "var(--font-sans)"
    fontSize: "12px"
    fontWeight: 600
rounded:
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.625rem"
  xl: "0.875rem"
  4xl: "1.625rem"
  studio-control: "6px"
  studio-node: "12px"
spacing:
  2: "8px"
  3: "12px"
  4: "16px"
  5: "20px"
  6: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  input:
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "4px 10px"
  card:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xl}"
    padding: "16px"
  badge:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.4xl}"
    height: "20px"
    padding: "2px 8px"
  auditor-navigation-active:
    backgroundColor: "{colors.auditor-sidebar-accent}"
    textColor: "{colors.auditor-sidebar-accent-foreground}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "8px"
  studio-button-primary:
    backgroundColor: "{colors.studio-green}"
    textColor: "{colors.background}"
    typography: "{typography.studio-label}"
    rounded: "{rounded.studio-control}"
    padding: "8px 12px"
  studio-button-secondary:
    backgroundColor: "{colors.background}"
    textColor: "{colors.studio-ink}"
    typography: "{typography.studio-label}"
    rounded: "{rounded.studio-control}"
    padding: "8px 12px"
  studio-input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.studio-ink}"
    rounded: "{rounded.studio-control}"
    padding: "9px 10px"
  studio-node:
    backgroundColor: "{colors.background}"
    textColor: "{colors.studio-ink}"
    rounded: "{rounded.studio-node}"
    width: "230px"
    height: "157px"
    padding: "15px"
---

# Design System: Neo-Luddite expert workspace

## Overview

**Creative North Star: "The existing Korean expert workspace"**

This is a descriptive record of the incumbent application, not a replacement identity. Korean Pretendard text, dark role-colored navigation, white working surfaces, fine borders and Lucide line icons define the workspace. The expert role uses green; the shared application also retains its blue viewer and amber administrator themes.

Agent Studio extends that workspace with compact editing controls and a diagram surface. Values prefixed `studio-` apply to `/audit/agents`; they do not replace shared tokens. Its canvas, inspector and simulation arrangement is a surface decision documented in [the Agent Studio brief](design/agent-studio.md), not a required composition for future pages. The user approved retaining the existing identity and building this surface in code without raster assets.

**Key Characteristics:**

- Korean interface text in the existing locally loaded Pretendard family.
- Role-colored navigation beside restrained, mostly white content surfaces.
- Borders and tonal changes carry grouping, selection and feedback.
- Agent Studio keeps editing, simulation and recorded data visibly distinct.

Source of truth: `frontend/app/globals.css`, `frontend/app/layout.tsx`, the shared `frontend/components/ui/` primitives and `frontend/components/layout/audit-shell.tsx`. Studio details come from `frontend/components/audit/agents/agent-studio.module.css` and its component. The frontmatter records selected reusable light-theme values. Existing dark and other role overrides remain in source; this record does not claim that Studio has a complete dark theme.

The companion `.impeccable/design.json` contains component previews and schema extensions. Its generated tonal ramps are preview aids, not additional colors adopted by the application.

## Colors

The shared palette combines cool blue actions, green expert navigation and neutral working surfaces; Studio uses a deeper local green for editing and execution.

### Primary

- **Shared action blue** (`primary`): the default shared Button and Badge accent. It remains blue even though the expert shell is green.
- **Brand blue** (`brand-blue`): the viewer identity and one end of the existing background treatment.
- **Brand green** (`brand-green`): the expert identity, sidebar highlights and expert background treatment.
- **Expert forest** (`auditor-sidebar`): the expert sidebar, paired with `auditor-sidebar-foreground`; active and hovered rows use the corresponding sidebar accent pair.
- **Studio action green** (`studio-green`, Studio only): save/run buttons, keyboard outlines, selected nodes, used connections and trace links.

### Secondary

- **Brand amber** (`brand-amber`): the existing administrator identity.
- **Studio recommendation amber** (`studio-handoff` and `studio-handoff-ink`, Studio only): a simulated recommendation to consult a person. It is a result state, not a global secondary action color.

### Neutral

- **White working surface** (`background`): shared card surfaces and Studio's editor/test areas.
- **Shared ink, muted surface, muted ink and divider** (`foreground`, `muted`, `muted-foreground`, `border`): shared content and component hierarchy.
- **Studio ink, quiet ink and divider** (`studio-ink`, `studio-muted`, `studio-line`): the local text and separation palette.
- **Studio canvas and active wash** (`studio-canvas`, `studio-active`): diagram background and currently executing node.
- **Studio field border** (`studio-field-line`): form-control boundaries.

**The Role Scope Rule.** Preserve the shared role themes. Studio's green controls are local to Studio and do not redefine the application's shared primary token.

## Typography

**Display and Body Font:** locally loaded Pretendard Variable through `--font-sans`; Korean is the document language. The local font is loaded with swap behavior and variable weight support. **Mono Font:** Geist Mono is available through `--font-geist-mono`; Studio trace text deliberately inherits the reading font.

### Hierarchy

- **Display** (`display`): the existing global h1 baseline, growing to (3rem) at the shared small-screen breakpoint (640px). This large heading scale is not used by Studio's toolbar.
- **Title** (`title`): shared card titles; shared compact card titles step down to (14px).
- **Body** (`body`): shared compact controls and Studio's base reading size. Studio answer paragraphs use (13px) with a line height of (1.7); textareas and trace text use (1.65).
- **Studio headline** (`studio-headline`): the toolbar title, stepping down to (20px) at Studio's mobile breakpoint.
- **Studio section** (`studio-section`): workflow, inspector and test section headings.
- **Studio label** (`studio-label`): field labels and action text. Supporting metadata is smaller in the current surface; those small sizes are not a new global body-text rule.

## Layout

The expert shell has a sidebar and a full-height content inset. Its standard sidebar is (16rem), its icon rail is (3rem), and its mobile sheet is (18rem). The mobile sidebar hook switches below (768px). A compact shell header (48px) remains above the page content.

Shared controls, cards and navigation use a small spacing rhythm represented by the frontmatter steps. Shared cards use (16px) internal spacing, reduced to (12px) for their compact variant. Studio uses (24px) horizontal section padding on wide screens, (20px) in the inspector, and (16px) in mobile content. Its gaps vary with the control group; there is no universal equal-spacing rule.

**Studio only:** a flexible work area sits beside a (330px) inspector. The flow occupies the upper work area and the test panel sits beneath it. At a viewport width of (1200px) or less, the inspector becomes (300px). At (900px) or less, explicit workflow/settings/test tabs replace simultaneous panels. Selecting a node opens settings; a completed node's trace action opens the test view and focuses its expanded record. Diagram overflow stays in the canvas scroller. The graph has a minimum width of (860px), and nodes remain readable at their fixed size while the user pans.

## Elevation & Depth

Studio is flat: its panels and nodes use borders, white surfaces and quiet green fills without box shadows. Selected nodes gain a heavier border while their inner padding compensates for it, preserving their footprint. The shared library uses outline rings for cards and focus; other existing shell variants may have their own shadows. Do not infer a global shadow prohibition from Studio.

The existing background layer uses soft role-colored radial gradients and procedural SVG grain. That inherited treatment is mostly covered by the opaque Studio workspace. The grain is generated in code; it is not a shipped raster asset.

### Shadow Vocabulary

- **Shared card outline:** a (1px) foreground ring at (10%) opacity; it separates the surface rather than lifting it.
- **Shared keyboard focus:** a (3px) ring using the shared ring color at (50%) opacity, paired with a matching border.
- **Studio keyboard focus:** an outline (2px) in Studio green with an offset of (3px), applied to buttons, inputs, textareas and selects.

## Shapes

Shared radii derive from the root radius (0.625rem), with the named scale recorded above. Shared buttons and inputs use `lg`; cards use `xl`; badges use `4xl`. Those rounded badge forms already belong to the application.

Studio uses the smaller `studio-control` radius for forms and buttons, `studio-node` for workflow nodes, and (8px) corners for grouped handoff settings and recommendation messages. Nodes are fixed rectangular controls; connections are SVG curves with arrowheads. Conditional connections are dashed; unconditional connections are solid. The pale dotted grid is a local diagram treatment, not a required background for other pages.

## Components

### Buttons

Shared actions are compact rounded controls. Their primary, outline, secondary, ghost, destructive and link variants are defined in the shared Button component. The standard control height is represented in the frontmatter; the component also provides smaller, larger and icon sizes. Keyboard focus uses the shared ring, and ordinary active buttons move down (1px).

Studio actions use their own local classes: green primary actions, bordered white secondary actions, green text actions and restrained red-brown deletion controls. Primary hover darkens the green; secondary and text hover add a pale green wash. The minimum action height is (36px). Disabled Studio buttons reduce opacity to (50%) and show the disabled cursor. Lucide icons accompany readable action names; icon-only deletion controls carry accessible labels.

### Chips

Shared badges are compact rounded labels with the shared variant colors. Studio's prototype and simulation labels are a local bordered tag treatment with (5px) corners. They describe the surface and execution mode; they are not decorative section kickers.

### Cards / Containers

The shared Card is a rounded white container with an outline ring and internal spacing variants. Studio uses divided working regions instead of wrapping every panel in a card. Its graph nodes are selectable buttons with a role/icon row, stage name, clipped instruction preview and model/status footer. Selection adds a (2px) green border; execution adds a green wash. A separate trace action appears when a record is available.

### Inputs / Fields

Shared inputs use the theme border and focus ring, with error and disabled variants supplied by the component. Studio fields are white, fully sized to their container and outlined with the local field border. Labels sit above their fields; selected groups of controls may be horizontal where space allows. Textareas resize vertically and preserve comfortable multiline leading. Studio uses the same green keyboard outline as its buttons.

Studio validation messages appear in both the workflow and test context so that the explanation remains available when mobile panels are switched. These messages list concrete configuration problems and provide routes back to editing.

### Navigation

Expert sidebar rows pair Lucide line icons with Korean labels. Hovered and active rows use the lighter expert green, and active rows increase text weight. The sidebar retains its existing mobile sheet behavior. Studio's mobile task navigation is separate: selected task text and a bottom border turn green, with selection expressed through `aria-pressed`.

### Studio simulation and trace

Simulation retains a visible mode label and explanatory copy. Results distinguish the customer's question, example response and optional expert recommendation. Stage records expand to show actual routed input data, output data, the instruction snapshot and source notes. The supplied sample confidence is labeled separately from fact completeness. This is prototype behavior, not measured model accuracy.

Node border and background changes transition over (150ms); the node transition is removed for reduced motion. Trace navigation uses immediate scrolling and moves focus to the relevant summary. No raster artwork is used in this surface.

## Do's and Don'ts

### Do:

- **Do** retain Pretendard, Korean interface language and the incumbent role-colored navigation when extending this workspace.
- **Do** distinguish shared tokens from values explicitly scoped to Agent Studio.
- **Do** use the existing line icons, borders and tonal states to explain available actions and selection.
- **Do** keep Studio's simulation labels, concrete validation messages and inspectable trace data visible in the relevant task view.
- **Do** preserve keyboard focus treatments and the node reduced-motion override.

### Don't:

- **Don't** replace the application's identity or convert its shared primary color to Studio green as part of this extension.
- **Don't** make Studio's three-panel composition, diagram grid or local radii mandatory for unrelated screens.
- **Don't** present sample confidence as measured accuracy or browser-local demo separation as production privacy.
- **Don't** treat verification screenshots as shipping product imagery.

Not canonized or repaired: Studio's fixed light colors do not implement the shared dark palette, and its dense (10–11px) metadata is recorded as a surface observation rather than a recommended global type scale. Other pages and production identity/access decisions were outside this documentation pass.
