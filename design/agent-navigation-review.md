# Agent navigation and interrupted-work review

2026-10-06. Follow-up to the user's report that navigation was wrong. Scope: expert agent teaching, personal knowledge, shared contribution preparation and return paths. Preserve the established luminous visual system.

## Findings before correction

1. At 1024px the horizontal task navigation occupied two rows (112px), with participation detached below the agent tasks. It also contradicted the sidebar's separation of agent settings, expert-wide knowledge contributions and consultation operations.
2. Contribution edits lived only in a mounted detail component. Navigating away discarded the text. The visible agent Save button saved a different object and could falsely reassure the author. Transcript intake also disappeared on task changes.
3. Teaching method was local component state. Returning to a manual draft or following “continue teaching” opened the session-import method instead.
4. Shared proposal preparation lost its originating case selection. The generic new-proposal button reused the source context and could copy an existing case instead of opening a blank proposal.
5. On mobile, choosing a source populated an import panel below the viewport without revealing or announcing it. Persistent editor chrome further reduced the available work area.
6. Advancing manual teaching could leave the next heading above the viewport. Contribution reload and history navigation could select the correct record while leaving its detail below the viewport.
7. Browser Back restored a knowledge-search URL without restoring the displayed search text and results.
8. Production query transitions could stall because the agent layout discarded its child route outlet. Rendering that outlet restored teaching-method transitions. This required a production browser check; development behavior and a successful build did not establish correctness.

The previous verification covered complete submission and review journeys. It did not adequately test interrupted work, alternate entry points or the distinction between saving an agent and saving a contribution.

## Intended interaction contract

- The sidebar is the canonical workspace hierarchy. Agent-only navigation contains overview, teaching, personal knowledge, principles, preview and advanced settings. A compact selector provides those same destinations when the sidebar is hidden. Contributions and consultation participation remain separate workspace destinations.
- Contributions live at `/audit/contributions`, scoped to the expert. Old links redirect with their context intact. This page has its own save state and contains no agent-save or agent-creation controls.
- Teaching method and knowledge selection have stable URL state. Continuing a draft returns to its method and step. Switching agents clears record IDs belonging to the prior agent.
- Transcript intake belongs to the private agent draft and survives navigation. Choosing a source reveals and focuses the populated import panel. Replacing a working lesson requires an explicit discard choice.
- Private lesson application saves the resulting knowledge in the same action. Contribution drafts save automatically as the author edits; storage failures retain the working copy and block silent loss. Submission remains a separate, explicit action after permission and privacy review.
- Preparing a contribution retains an explicit return to the originating personal case/question. A new proposal is blank. List/detail navigation and browser history restore the selected record.

## Verification completed

- **Automated:** 79 unit tests passed on the combined tree after concurrent main commit `296e8cd` (77 before that commit's two additional tests). New navigation cases cover route scope/context, persisted transcript intake, and more than 500 draft edits without exhausting the contribution event history or altering a submitted snapshot. Focused ESLint passed with zero warnings. Production verification used an isolated copy of staged changes, excluding unrelated uncommitted landing-page edits.
- **Final integration:** the combined staged production build passed, including TypeScript and all 55 generated pages. The three navigation browser regressions passed again against that build (6.7 seconds).
- **Production browser regressions:** all three tests in `frontend/e2e/agent-navigation.spec.ts` passed: transcript intake across method changes/save/reload and manual resume; knowledge search Back/Forward; applying private knowledge, selecting its exact record, preparing a separate shared copy, autosave across leave/return/reload, legacy redirect, and a genuinely blank new proposal.
- **Interruption failures:** a simulated contribution storage failure retained typed text across list/detail navigation and succeeded on retry. A real second tab's newer edit prevented the stale tab from overwriting it; the stale tab retained its text until an explicit discard-and-reload choice. These checks used synthetic local records.
- **Layout and focus:** Chromium at 1440, 1280, 1024, 768, 390 and 320px; no horizontal document overflow in the inspected teaching and contribution states. Sidebar-open and sidebar-collapsed navigation, the mobile task selector, manual step progression, populated-source focus, and contribution reload landing were exercised. Both light and dark themes were captured. Viewport assertions checked actual visibility, not just DOM presence.
- **Context and scope:** the question shortcut opens questions, applied lessons open the exact case, shared edits leave private knowledge unchanged, and missing-source links show a recovery message. Agent-switch record cleanup is covered by the navigation unit test.
- **Publication:** submitted the synthetic proposal as an expert, completed all four operator review checks, published it, reloaded the recorded publication and reward eligibility, then signed back in as the author and verified the reflected record. The production browser console reported zero errors or warnings.

Run the prototype browser regression against an already running production frontend:

```sh
cd frontend
E2E_BASE_URL=http://localhost:3024 npx playwright test e2e/agent-navigation.spec.ts
```

The named spec uses isolated browser contexts and synthetic local data. The repository's older E2E suites have separate live-backend requirements.

## Overall flow assessment

The expert journey is now explicit: choose a teaching method → retain a working draft → review and save reusable private knowledge → optionally create a separate shared proposal → request review → track the publication and contribution record. Personal customization, collective knowledge and consultation operations have distinct destinations. Each transition preserves its relevant record and explains what was saved.

The initial independent review identified the interruption and scope problems before implementation. The correction pass preserves the existing luminous shell and solid reading/editing surfaces. The design detector ran once and returned no source findings. Browser overlay observations about existing layout transitions and small metadata were reviewed, without treating them as additional blockers.

The final independent screenshot/source reviewer returned **ship**, with no material corrections remaining in the inspected scope. It checked all six teaching widths, focused mobile transitions, contribution landing states and dark mode. A dark screenshot was recaptured after its color transition settled; both return links resolve to the established `rgb(153, 217, 200)` dark accent. That review is separate from the implementation agent's live browser and automated checks; it was not an independent accessibility audit.

The independent documenter updated the workspace brief, flow document and learning/contribution contract against the final source. It verified their links and code fences and confirmed reuse of the incumbent design tokens and reading surfaces. `DESIGN.md` and `.impeccable/design.json` remain unchanged. Review-only production servers and browser sessions were stopped after verification.

Questions skipped: the user had already authorized autonomous correction and delivery to main; the observed failures had concrete, reproducible fixes.

## Practical limits

This remains a browser-local prototype. Private draft changes require **변경 저장** before reload; applying reviewed knowledge saves it in the same action. Shared drafts autosave independently. If browser storage is unavailable, a failed shared working copy survives workspace navigation in memory and triggers a page-exit warning; it is not durable after closing the browser or discarding the warning.

Chat/transcript import does not perform audio transcription or LLM analysis. Operator publication, attribution and reward eligibility are local demonstrations. Actual shared KB deployment, model improvement measurement, backend authorization, cross-device durability, and reward payment remain integration work. The UI does not claim that a submission alone trains a model or earns money.
