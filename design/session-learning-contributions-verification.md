# Consultation learning and shared contribution verification

Verified on 2026-10-06. Product contract and backend handoff: [session-learning-contributions.md](./session-learning-contributions.md).

## Implemented scope

- `/audit/agents/teach`: speaker-labeled consultation text, private source preservation, expert rationale and applicability, manual contrasting-scenario review, personal application, and a separate contribution gateway.
- `/audit/agents/contributions`: proposals across the current expert's agents, independent sharing drafts, permission and privacy review, submitted revisions, reviewer feedback, publication attribution, and credit eligibility.
- `/admin/knowledge-contributions`: reviewer-only domain transitions for changes, rejection, publication, and retraction. Publication records the four review checks and connects an accepted revision to one credit record.
- `/audit/agents/preview`: published answer/correction cases form a temporary shared retrieval overlay. Another expert can reference the publication with its author, version, and contribution ID; shared cases stay out of the editable personal library.

## Automated evidence

- `cd frontend && npm test`: **72 passed, 0 failed**. The 16 new tests cover import permission, verbatim provenance, absent rationale, review gates, session-only exclusion, idempotent personal application, persistence, sharing payload separation, author/reviewer roles, stale versions, immutable submitted revisions, publication checks, duplicate credit prevention, retraction, obvious identifier rejection, and cross-expert shared retrieval.
- Focused ESLint over all added and changed TypeScript/TSX files: passed without warnings.
- `cd frontend && npm run build`: passed, including TypeScript and 54 generated pages. The contribution routes are present in the generated route list.
- `git diff --check`: passed.

The final staged application code was also exported into an isolated directory with the repository's installed dependencies. All 72 tests and the production build passed there, excluding the pre-existing, unstaged landing/chat edits. A final mobile review capture ran against that isolated production build.

These are focused feature checks, not a claim that unrelated repository-wide lint has been fixed.

## Browser evidence

Chromium against the production server, at desktop 1440 × 1000 and mobile 390 × 844, with an additional settled dark-theme capture:

1. Opened the synthetic mixed-use equipment conversation; inspected speaker labels and timestamped source. The proposed rationale remained empty for the expert to supply.
2. Supplied rationale, scope, keywords, and a contrasting scenario with an expected response; reviewed and applied the lesson privately, then saved the agent.
3. Entered the contribution gateway, prepared a separate sharing draft, acknowledged privacy and permission, and submitted it. Reload preserved the contribution.
4. Signed in as administrator, requested a scope change, then returned as the author and submitted revision 2 under the same contribution ID.
5. Published revision 2 as the administrator. The author's ledger displayed one published contribution and one reward-review-eligible record, with prior revisions and feedback intact.
6. Signed in as a second expert. Their own ledger counts remained zero; their rehearsal retrieved the first expert's published case and displayed its author, publication version, and contribution ID.
7. Reviewed mobile entry, list, detail, review actions, credit history, and dark-theme reading surfaces. No material horizontal overflow was observed.

Browser evidence is local under `.impeccable/review/` and is not shipped as an application asset. Captures include `session-desktop.png`, `session-mobile.png`, `contribution-desktop.png`, `contribution-mobile.png`, `contribution-list-mobile.png`, `contribution-detail-mobile.png`, `review-desktop.png`, `review-mobile.png`, `review-actions-mobile.png`, `credit-desktop.png`, `credit-mobile.png`, `credit-mobile-dark.png`, and `shared-rehearsal-desktop.png`.

The browser log contains unused CSS-preload warnings. No application console errors were recorded in the verified journey. Most visual captures precede the final domain-only additions for explicit review-check validation and persisted checks; those additions are covered by the final passing tests and build. `review-mobile-final.png` uses the final staged application code and confirms the status badge's computed 6px radius after the documentation handoff identified an undefined local token.

## Independent finish review

Impeccable detector ran once on the new UI targets and returned no findings. A fresh reviewer first requested corrected page-top mobile captures; the full review was rerun against those replacements. Final disposition: **ship**, with no material fixes within the reviewed browser-local extension. Review covered the inherited luminous system, desktop/mobile/dark fidelity, source/editor separation, contribution history, attribution, and prototype truth. Interaction and test results were supplied by the builder; the independent reviewer inspected captures and sampled code.

The documentation handoff compares this extension against the existing `DESIGN.md` and `.impeccable/design.json`; this work does not replace the application design system or add raster assets.

The documenter's single local radius correction received a separate, narrowly scoped reviewer verdict: **resolved / ship**. That verdict applies only to the corrected badge radius; the earlier full extension review remains the basis for the broader finish assessment.

## Limits of the evidence

This is a browser-local prototype. Tests exercise deterministic rules and transitions, not semantic extraction quality, legal accuracy, speech recognition, live RAG ingestion, model training, production authorization, or payments. Manual scenario review is not an automated model evaluation. Shared question proposals are reviewable records but do not automatically become executable fact-collection rules. Source text and contribution records do not synchronize across browsers or devices.

Production still needs authenticated storage, consent and retention enforcement, source/duplicate/conflict verification, atomic review and publication, retrieval/index versioning, and a reviewed reward policy. Current credit records preserve author attribution and eligibility only; they do not represent money owed, verified usage impact, or paid rewards.
