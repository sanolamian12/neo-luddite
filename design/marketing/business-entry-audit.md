# Business-owner chat entry and tax-accountant application

## Evidence checked on 2026-11-04

- The original homepage addresses business owners, but `frontend/lib/entry-chat.ts` created only `occupation: clinic` and linked to `/chat/clinic`. The thread context label repeated “병의원 상담”. `/chat/general` was blocked by the frontend's coming-soon state.
- The API host embedded in the original homepage's public JavaScript returned HTTP 200 for GET `/openapi.json`. `ChatRequest.occupation` allows `general`, `clinic`, `online-seller`, and `beauty`; `/api/chat` exists. This was a contract read, without sending a chat request.
- Source `backend/api/schema.py` declares the same enum. `backend/api/main.py` passes the supplied occupation to the pipeline. `backend/api/pipeline.py` explicitly sends non-clinic requests through advisory handling and enables the clinic expense verdict engine only for `occupation == clinic`.
- Some extraction wording and search axes remain clinic-oriented in the backend. The general request contract does not establish answer quality, full industry coverage, accuracy, capacity or production conversion. This change makes no such claims and changes no backend behavior.
- The original `/expert/apply` guest page renders “세무사 가입 신청” and a Google/Kakao login prerequisite, linking to `/login?next=%2Fexpert%2Fapply`. Source uses `my_expert_application`, `submit_expert_application`, and withdrawal/review RPCs. Approval follows administrator verification of the tax-accountant registration information. No account login, application or database write was performed during this audit.

## Frontend change

New homepage/sidebar questions use `general`, and the general route opens the existing chat UI. Existing clinic records keep their category, URLs and clinic-specific examples. Storage rehydration accepts both categories, owner history/restoration keeps the saved category, and login/handoff return URLs retain it. Coming-soon specialty routes link to the general entry without claiming their specialized UI is available.

The general thread label is “사업자 세무 질문”. Home and About expose “세무사 파트너 신청하기” linking to the existing application flow. Guest history is labeled “이 브라우저의 대화”. Existing AI-reference/final-tax-accountant-confirmation disclosures remain visible.

No backend, database, credentials, analytics or committed environment settings change. Existing public API and database contracts are consumed as-is. Browser verification uses local-only placeholder service configuration and intercepted chat responses, not production inference or registration.

## Verification

From `frontend/`, run `npm test`, `npx tsc --noEmit`, changed-file ESLint and `npm run build`. The new tests verify the category passed to the responder, category/draft persistence, general login-return URLs including connect IDs, clinic URLs, and mixed old/new storage.

For browser QA, run a local live-mode server with a local mock API/Supabase URL, intercept chat POSTs and return a fixed schema-valid reply. Check homepage → general thread → draft → login → public return → reload, direct clinic entry and existing-clinic history, coming-soon links, and partner-application links at mobile widths. Do not point this QA at production inference or use real accounts.
