# Iteration 2 verification

2026-10-01. Scope: [delivery plan](agent-customization-iteration-2.md), [current PRD](agent-customization-prd.md), [flows](agent-customization-flows.md), [policy contract](agent-policy-contract.md). The first-pass verification record remains historical evidence for that version.

## Automated checks

- Frontend unit suite: 47 passing tests. Added coverage for topic selection versus facts, required/optional field accounting, follow-up counting by conversation and field, unknown answers, same-field comparison, exception matching, invalid references, actual-fact rehearsal gating, source attribution, review trace, shared-example migration, and task URLs with encoded agent identity.
- Focused ESLint for agent components, routes, sidebar and domain code, TypeScript and production build passed. A broader lint over every touched file reports the pre-existing `react-hooks/set-state-in-effect` error in `mailbox-view.tsx:60`; the unchanged effect is present in the starting commit. Only explanatory mailbox copy changed in this iteration. The build generated 52 static pages; dynamic routes remain dynamic. No dependencies or backend migrations were added.
- The design detector ran once on changed UI targets and returned an empty findings list (`[]`) in `.impeccable/review/iteration2/detector.json`. This is detector evidence, not a whole-surface finish verdict.

## Browser behavior

Development and production Chromium checks covered task navigation, back history, saved rules after reload, hidden shared examples in personal knowledge, editable follow-up limits, missing-fact withholding, answer eligibility after facts are supplied, same-field conflict, explicit human request, same-thread expert reply, paused AI while the expert owns the conversation, and return to AI.

Advanced-stage edits survived a practice-page save and reload. Returning from advanced retained agent identity. Unknown agent IDs showed recovery; copying an agent created a distinct ID that survived save and direct-link reload. The first automation attempt raced a route transition before Back; waiting for the destination URL resolved the test sequencing issue without an application change.

Production checks also added a personal knowledge question, copied it into a required rule field, removed it, and verified validation on a new rule without keywords. Marking a required fact unknown kept it unconfirmed and withheld the conclusion; an actual personal-use value matched the configured exception. Logging out and signing into a second expert showed a separate library, and opening the first expert's agent ID displayed recovery rather than that agent.

## Visual evidence

All 12 captures below were taken from a production build with reduced motion and settled fonts, and opened by the lead. They are ignored local artifacts under `.impeccable/review/iteration2/`, not shipped assets. Full-page capture includes the document top; names beginning criteria/facts and the inbox detail capture deliberately show a scrolled inner work region.

| Captures | Viewport |
| --- | --- |
| dashboard-desktop, rules-desktop, criteria-desktop, knowledge-desktop, preview-desktop | 1440 × 1000 |
| dashboard-mobile, rules-mobile, criteria-mobile, preview-mobile-dark, facts-mobile-dark, inbox-mobile-dark | 390 × 844 |
| sidebar-320-dark | 320 × 740 |

No document-level horizontal overflow was observed in these viewports. Sidebar tasks and the selected participation conversation remained accessible on mobile. This is Chromium evidence, not mobile Safari or screen-reader speech certification.

## Independent finish review

The initial 12 production captures were accepted as valid evidence. Review requested two dashboard corrections: the direct-participation count could link to a conversation already owned by a human, and the heading carried an unnecessary eyebrow. The waiting count and its destination now come from the same waiting-only set; the destination includes both the agent ID and conversation ID. The dashboard heading no longer has the eyebrow.

The dashboard-desktop and dashboard-mobile captures were refreshed after these corrections and opened by the lead. They deliberately use a synthetic two-agent browser fixture: one agent already participating and another with a waiting conversation. Clicking the waiting count opens the latter conversation. These refreshed files replace the corresponding two captures in the 12-file inventory above; the other ten remain the initial evidence. The fixture is local verification data, not shipped artwork or a claim about live customers.

The final review scored both corrections resolved and returned `ship` for those two fixes only. It does not constitute a new whole-surface approval of every retained agent page, the consultation application view or advanced Studio.

## Design-system comparison

This iteration extends the incumbent luminous world. The documenter compared `DESIGN.md` and `.impeccable/design.json` with `frontend/components/design-system/luminous.css`, sampled the agent practice and Studio styles, and inspected the dashboard, criteria, consultation hub, expert sidebar and audit shell sources.

| System evidence | Result |
| --- | --- |
| Palette | All 49 frontmatter color values match their light/dark CSS declarations, including the theme-specific primary foreground. The sidecar retains 49 color metadata entries. No palette token was added or changed. |
| Type | Pretendard remains the inherited family. Practice uses 14px interface text, 12–13px supporting text and 25–27px main task headings; the new dashboard uses a local `clamp(28px, 3vw, 38px)` heading, 18px queue headings and 28px counts. These are surface compositions, not changes to the global type ramp. |
| Materials and shapes | Paper inputs, glass navigation/agent summary, semantic status pairs, field boundaries and the existing surface shadow are reused. Controls use the 10px token, cards 18px and panels 24px. The criteria fieldset's 12px corners remain local rather than becoming a new shared radius. |
| Layout and motion | Practice retains its established 1360px content limit and responsive task arrangements. Dashboard gutters/grid and criteria columns are local additions. Existing focus, reduced-motion and theme behavior remain the underlying system. No artwork or new global motion token was introduced. |
| Named rules | Material, decorative tone and semantic status remain independent; editing stays on readable paper surfaces; luminous adoption stays explicit in the audit shell. |

`DESIGN.md`, `.impeccable/design.json`, the luminous foundations and shell stylesheet remain unchanged. Their older route-adoption and contribution-dashboard prose predates this iteration: the prototype now adopts luminous styling for consultations, and its dashboard uses consultation queues. This documentation drift is reported here and in the scoped briefs, not repaired or promoted into new system rules. The removed dashboard eyebrow is a resolved defect, not a reusable style. No new world, token set or raster provenance record is needed.

Current surface behavior is documented in [agent practice](agent-practice.md), [expert workspace](expert-workspace.md) and [advanced Studio](agent-studio.md). Earlier verification records retain their historical scope.

## Integration limits

These checks establish deterministic local behavior. The repository still uses browser-local prototype identities and data; no authenticated publication, live LLM, shared corpus ingestion, semantic extraction, backend workflow execution or real client delivery is connected. Advanced graph simulation remains separate. Rules define supported operations as data, not arbitrary generated code.
