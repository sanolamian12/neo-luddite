# Supabase registration and login

Live mode supports Google and Kakao social registration/sign-in at `/register` and `/login`. Supabase creates the Auth user on first consent; migration `0047_social_registration.sql` creates its customer profile. Returning users use the same provider. Existing email/password accounts (including the legacy `name@demo.local` username mapping) can still log in. This change does not add password registration or recovery.

## Enable the live service

1. **Apply `supabase/migrations/0047_social_registration.sql` before enabling public registration.** It prevents user metadata from assigning roles/domain IDs and prevents profile self-updates from changing identity or privileges. Existing profiles are not rewritten. Review and apply through the project's normal Supabase migration workflow; do not run `db reset` or the demo seed against production.
2. Set `frontend/.env.local` or deployment build variables from `frontend/.env.example`: `NEXT_PUBLIC_DATA_MODE=live`, the Supabase project URL, its public publishable/anon key, and the Python API base URL. Frontend configuration is embedded at build time; rebuild after changes. Without `live`, the existing offline prototype remains selected.
3. Set `NEXT_PUBLIC_AUTH_PROVIDERS=google,kakao` (or `google` for a Google-only launch). This controls visible buttons; it does not activate providers in Supabase.
4. In Supabase → Authentication → URL Configuration, set Site URL to the deployed frontend origin. Add its `/auth/callback` URL and the local callback `http://localhost:3015/auth/callback` to Redirect URLs. Permit the callback's optional `next` query string as well (a narrowly scoped `https://YOUR-APP/auth/callback**` entry covers it); do not allow arbitrary production origins. Add preview origins individually if they need sign-in.
5. Configure the providers below and enable them in Supabase → Authentication → Sign In / Providers. Keep provider client secrets only in the dashboard; never use `NEXT_PUBLIC_` for them.
6. Complete a first-time and returning-user sign-in using a provider test account on the actual deployed origin. Confirm a new customer gets `/select`, selection persists after reload, an existing chat is continued after sign-in, staff accounts retain their database roles, and logout removes access. Also cancel consent and retry.

### Google

Create an OAuth **Web application** in Google Auth Platform/Google Cloud. Configure its consent screen/audience, test users while in testing mode, and the basic `openid`, email and profile scopes. Add `https://PROJECT-REF.supabase.co/auth/v1/callback` as the authorized redirect URI. Put the OAuth client ID and secret in Supabase's Google provider and enable it.

### Kakao

Create an app in Kakao Developers, enable Kakao Login, add `https://PROJECT-REF.supabase.co/auth/v1/callback` as the Kakao redirect URI, and enable the login client secret. Put the REST API key (client ID) and client secret in Supabase's Kakao provider. Configure profile nickname/image consent. If `account_email` consent is unavailable or omitted, enable **Allow users without an email** in Supabase. The application identifies users by Auth UUID and does not require an email for social sign-in.

The provider callback URL above belongs to **Supabase**. The frontend `/auth/callback` is the second redirect and belongs in **Supabase's redirect allow list**.

## Session and authorization design

The existing frontend fetches data from browser services; the Python API verifies bearer tokens and database RLS enforces authorization. This change preserves that architecture. The browser Supabase singleton now uses PKCE, token persistence and automatic refresh. `/auth/callback` explicitly exchanges the code in the browser holding its verifier, removes OAuth parameters from browser history, and routes through the existing role-safe login/guest handoff. This is not cookie-based server rendering; future server components accessing private data need a separate server authentication design.

A root subscription verifies identity with `auth.getUser()` and reads the matching `profiles` row before rendering an authenticated role. Stored Zustand/demo roles cannot authenticate live mode. Auth events restore/revalidate state and clear it on sign-out, including cross-tab events. Rechecking the same identity preserves the open workspace; stale profile responses cannot restore a session after logout. A missing/malformed profile fails closed with a retryable error. Social login only requests identity access, not offline provider access.

New public accounts receive `role=user` and a UUID domain ID. Existing trusted provisioning can set `app_role` and `domain_id` through Auth **app metadata** (Admin API/server only). Staff approval for an existing account changes its `public.profiles.role` through an approved admin/database workflow; never take privileges from user metadata. The local demo seed now supplies trusted app metadata, retaining existing demo domain IDs. The profile guard retains administrator management privileges.

## Verification and limits

Run from `frontend/`:

```bash
npm ci
npm test
npx tsc --noEmit
npm run build
```

The test suite uses the real Supabase JS client with intercepted transport, plus PGlite's PostgreSQL engine for actual profile-trigger/RLS execution. Database tests run entirely in memory, using the repository's baseline profile schema and migration; they do not connect to or mutate a deployed Supabase database. Browser checks use a production frontend build and intercepted Auth/data endpoints. Existing live UI transport fixtures now provide verified Auth users and database profiles.

On 2026-10-07, the connected project's public Auth settings reported Google and Kakao disabled. Provider credentials and a real consent-screen round trip are a deployment prerequisite, not something the automated tests establish. The migration is included for review and was not applied to the live database.

Official references: [Google](https://supabase.com/docs/guides/auth/social-login/auth-google), [Kakao](https://supabase.com/docs/guides/auth/social-login/auth-kakao), [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow), [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).


### PR verification record (2026-10-07)

- 100 unit/database checks passed, including actual PostgreSQL profile-trigger/RLS execution, PKCE challenge/verifier exchange, forged persisted roles, refresh/logout races, and persisted occupation.
- Production build, TypeScript and focused ESLint passed.
- Five existing live chat/expert/admin browser tests passed with the updated verified-profile fixtures.
- Playwright CLI exercised Google first-time signup, Kakao returning login, session reload, occupation selection, mobile account-menu logout, rejected external continuations, cancelled OAuth/retry, invalid passwords, guest draft/conversation continuity, forged local admin state, missing profiles, and logout failure/retry against intercepted transport.
- Desktop (1440px) and mobile (390px) login/registration/error captures were inspected; the UI review disposition was `ship`. These checks do not constitute a live Google/Kakao consent round trip.
