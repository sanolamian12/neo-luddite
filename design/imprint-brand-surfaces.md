# Imprint on public surfaces

The approved additive extension is documented in [DESIGN.md](../DESIGN.md); its token frontmatter and [.impeccable/design.json](../.impeccable/design.json) carry the reusable system contract. This brief owns surface-specific composition and future recommendations.

## Direction

Extend the existing Luminous system with the green contour language from the Human Imprint film. The experience, judgment and contribution of an expert leave a recognizable trace. This is a visual identity, not a claim that a particular answer has been reviewed.

Use the expressive layer where people meet the service: landing, login, campaign covers and brand material. Keep consultation bubbles, knowledge evidence, expert editors and administrative tables focused on their content. Customer mint, expert blue and administrator amber continue to describe their respective workspaces; semantic status colors remain separate.

## Shipped composition

- The public header pairs the existing **세무상담** name with a compact, open contour mark. The name remains the accessible identity; the SVG is decorative.
- Landing retains its Korean headline, introductory copy, working guest chat and sample disclosure. One contour field sits between the story and its consultation journey. At 760px and below it becomes a 140px quiet edge detail with no extra vertical block; the guest chat keeps its place in the flow.
- Login puts the same field in its desktop story column. At 900px and below the story remains hidden, giving the form priority; the public mark carries the identity.
- `/design-system#brand` shows the mark and contour field together and records their permitted use.

## Primitives and ownership

`frontend/components/design-system/imprint.tsx` exports `ImprintMark` and `ImprintContours`. The shapes use deterministic SVG geometry with four strands for the mark and eighteen for the field. No canvas, image download, animation library or additional client state is needed. Geometry is an adaptation of the film's contour idea; it is not a copy of a video frame.

The root Luminous foundation owns the additive `--ds-imprint` and `--ds-imprint-soft` colors, plus `--ds-imprint-duration` and `--ds-imprint-ease` for the optional entrance trace. Color values live in the DESIGN.md frontmatter (`luminous-imprint*` and `luminous-dark-imprint*`); motion values live in the sidecar's `extensions.motion`. The colors change with light/dark theme and stay independent of workspace role. The soft field is currently used by the brand specimen.

`ImprintContours` is static by default. `reveal` draws only its leading strand once; the surrounding strands are already visible. Reduced motion removes that trace animation. Forced colors hides the large decoration and gives the compact mark `CanvasText`. Both primitives are hidden from assistive technology, cannot receive focus, and ignore pointer events.

```tsx
import { ImprintContours, ImprintMark } from "@/components/design-system/imprint";

<a href="/"><ImprintMark />세무상담</a>
<ImprintContours reveal />
```

## Recommendations for the next surfaces

1. **Registration and recovery:** reuse one shared public auth story composition, with an opaque form and the contour field outside it. This prototype repository currently has only `/login`; the separate auth implementation should adopt the same primitives when those routes are integrated.
2. **Brand and campaign material:** use a large, cropped field with one strong Pretendard headline. Pair teal ink with light paper or mint ink with dark paper. Keep the name and required content inside the safe area.
3. **Landing storytelling:** use the field once at entry or at a meaningful section boundary. Additional content should earn its place through product demonstration; do not repeat the same motif behind every card.

Do not use the motif as a verification seal, answer provenance, human/AI label, credit indicator, or loading spinner. Actual product states keep their explicit labels and existing semantic icons. Do not repeat tracing on scroll, hover, or message arrival.

## Scope

This change is visual. Guest chat, account login, local sample behavior and navigation contracts are preserved. It adds no authentication routes, model calls, backend authorization or data persistence.
