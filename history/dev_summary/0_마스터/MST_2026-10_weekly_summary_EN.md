# Neo-Luddite — October 2026 Weekly Development Summary

**Month in one line:** Replaced the product's three core pillars, turned the chat into a tax *calculator*, and held the numbers promised in the Oct 23 final report.

---

## W10 · Oct 4–10 — Three core pillars replaced in one week

**Keywords:** Frontend migration · KB3-only retrieval · Issue-relevance gate · Statute DB + LLM3 · Expert-taught RAG · Three-party chat · Social login · Account lifecycle

- **Frontend:** Adopted the team lead's prototype as the production frontend; guest chat wired to the live API.
- **Knowledge base (KB3):** 3,276 tax tribunal rulings + 1,825 NTS rulings (5,101 entries) loaded to production. Chat now grounds answers on KB3 only. Off-issue cards are dropped before answer generation.
- **Statutes:** In-house article DB (17 laws, 8,498 rows) plus a selection-only LLM ("LLM3"). "No source" answers fell from 18 to 1 (48 citizen questions).
- **Latency:** Moved vector search into memory. 25.7 / 21.5 / 162 s → 10.3 / 7.8 / 11.7 s.
- **Expert features:** Tax accountants teach their own AI → private RAG → admin-approved shared RAG. Customer–expert–AI three-party chat room.
- **Accounts:** Google/Kakao sign-up, expert approval and revocation, account deletion (migrations 0042–0051).

## W11 · Oct 11–17 — The chat starts calculating; report KPIs become release gates

**Keywords:** Deterministic tax calculation · Statute table restoration · Solar Pro 4 · Question-type routing · Conclusion-first answers · Expert feedback loop · KPI release gate · Egress fix

- **Income tax calculator:** No LLM in the arithmetic. One-turn step table with stated assumptions and statute badges.
- **Statute tables:** Restored from official API text (232 articles, 396 tables). Rate questions now return the 8-bracket table with source numbers.
- **Model:** Switched production to Solar Pro 4 (p50 7.7 s, p90 12.1 s).
- **Answer quality:** Source citation 94.4% · question-type classification 95.9% · expert-question format 20/20.
- **Expert feedback:** Re-evaluation flagged a regression (Q3: 2/2/2). Fixed with conclusion-first answers, de-duplication, and delegated-decree coverage.
- **Release gate:** Every deploy runs a 162-turn demo set judged against the final-report KPIs. Result: 0 misses.
- **Infra:** Supabase egress (674 MB per restart) eliminated with a disk cache. Legacy KB2 deleted (DB 421.6 → 336.8 MB).
- **Instant expert connect:** Anonymous visitor → one-tap social login → three-party room, with the expert's AI greeting first.

## W12 · Oct 18–24 — Third expert evaluation up on every item; final-report numbers locked

**Keywords:** Expert evaluation round 3 · Conversation-history replay · Pre-submission deploy freeze · Load test · Stock capital-gains calculator · Citation badge fix · Admin usage dashboard

- **Expert evaluation round 3:** Q1–Q4 all rose to the 4-point range. The one remaining failure (take-home pay, 1/1/1) was reproduced by replaying the expert's real chat history, then fixed and shipped.
- **Definitions:** Definition-type questions went from 3/6 to 6/6.
- **Measurement and load:** Re-measurement moved up to Oct 19. Load test at 8 and 10 concurrent users: 0 stalls, 0 errors. Demo set: 0 misses. Citizen set: 0 "no source". Answer path frozen until the Oct 23 report.
- **Stock transfer tax calculator:** Live in production (`STOCK_CALC=on`). Production amounts match local; demo smoke 14/14 unchanged.
- **Citation badges:** Fixed a mismatch (Art. 167-8 matched as Art. 167). 20 badges change across 4,063 past turns.
- **Admin:** Usage dashboard (`/admin/usage`) with a read RPC (0064) and a conversation-attribution fix (0065).

## W13 · Oct 25–31 — Last week before the demo: gift tax extended; latency traced to the LLM provider

**Keywords:** Gift tax calculator · Marriage/birth deduction · 10-year aggregation · Burden-bearing gift · Decree §159 restoration · Latency root cause · First-turn prefetch · Load-aware gating · Landing page

- **Gift tax:** Calculation path for the marriage-fund scenario, with the marriage/birth deduction and 10-year aggregation (`GIFT_CALC=on`).
- **Burden-bearing gift:** Gift tax plus the donor's capital gains tax. Fixes over-calculation from ignoring assumed debt. Decree §159 formula restored from official text. Production amounts match local.
- **Latency root cause:** 486-turn re-measurement met every quality KPI; only p50 (10.3 s) missed. Cause: Upstage generation speed dropped from 84 to 67–73 tok/s. Our code was not the cause.
- **First-turn prefetch:** Citizen-set p50 went from 10.7 to 9.2 s. But at 8 concurrent users it added +8.5 s, so it now runs only on solo turns (+2.3 s). Recommendation: keep it on normally and turn it off for the Nov 3–5 demo.
- **Traffic:** Visits from a community post link now show up in the admin traffic-source view (verified end to end).
- **Landing:** New landing page and `/about`, ported from the prototype.
