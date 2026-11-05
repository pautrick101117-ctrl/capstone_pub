# Staff registration rate-limit fix

Production changes are limited to four files:

- [Admin routes](../server/src/routes/admin.js): remove the `admin-create-resident` endpoint limiter. Keep the upload middleware and account-creation handler unchanged.
- [Shared persistent limiter](../server/src/middleware/persistentLimit.js): exempt only authenticated `admin` / `super_admin` POST registrations whose JWT subject matches the resolved live account. Match the entire mounted route, allowing Express's existing case and optional trailing-slash behavior. Keep the global submission middleware and all other limits.
- [Server CORS configuration](../server/src/index.js): expose `Retry-After` so the browser can read it across origins.
- [Frontend API helper](../client/src/lib/api.js): display retry seconds for HTTP 429 responses, supporting both numeric and HTTP-date retry headers. Preserve existing error codes, messages, references and retry metadata for other failures.

| Operation | Before | After for authenticated Admin / Super Admin |
| --- | --- | --- |
| `POST /api/admin/users` | 10 attempts/hour plus 60 attempts/10 minutes | No application registration attempt cap |
| `POST /api/admin/census_households` | 60 attempts/10 minutes | No application registration attempt cap |
| `POST /api/admin/census_households/:householdId/members` | 60 attempts/10 minutes | No application registration attempt cap |
| `POST /api/admin/census_households/batch` | 60 attempts/10 minutes | No application registration attempt cap |
| Other staff writes and sensitive operations | Existing shared and endpoint limits | Existing limits retained |
| Resident writes, login and password recovery | Existing protections | Existing protections retained |

Registration validation, duplicate detection, password handling, private ID storage, Resend acceptance requirements, failed-creation cleanup and audit behavior retain their existing business rules. Database, upload and email errors retain their distinct codes and do not become application rate-limit responses.

## Regression coverage

- [HTTP integration tests](../server/test/staff-registration.test.js) run the real Express app, signed JWT authentication, current-user and role checks, multipart uploads, ID validation, bcrypt cost 12, registration handlers, mailer and application audit code. Stateful database/storage mocks and a Resend HTTP stub replace external services. Unexpected network calls are rejected. No live records or real emails are used.
- [Middleware and authentication tests](../server/test/rate-limits.test.js) verify exact route boundaries, identity checks, methods, mounts, nested limiter behavior, login limits and password-recovery limits.
- [Frontend error tests](../client/tests/api-timeout.test.mjs) verify visible retry seconds, HTTP-date headers, missing/invalid retry times and distinct email failures.
- Existing SQL integration tests use isolated PGlite databases to verify actual household uniqueness, atomic member registration and persistent rate-counter behavior. Member validation tests also cover household-head rules.

| Requested check | Coverage |
| --- | --- |
| Admin creates 100 residents consecutively | 100 real HTTP handler successes, mocked external services |
| Super Admin creates 100 residents consecutively | Same; both resident runs also start with exhausted old counters |
| Admin registers 100 households consecutively | 100 successes for each staff role, including household heads and children |
| Member registration remains unlimited | 100 additional members per staff role; relationships and resident links checked |
| Batch import remains functional | 100 append imports per staff role; preview and duplicate skipping checked |
| Unauthenticated registration is denied | All four routes reject missing/forged sessions; resident, inactive and password-change-required sessions also denied |
| Invalid resident data is rejected | 72 rejected submissions beyond the old attempt limits; required fields, age, role and controlled values checked |
| Duplicate protection remains | Duplicate emails rejected, username collisions resolved uniquely, duplicate households rejected; SQL constraints also tested |
| ID validation remains | Missing, excessive, oversized, mismatched, invalid-image and invalid-metadata uploads rejected; five valid images accepted |
| Login and reset limits remain | Ten-failure account/IP login limits; five-attempt account limits on both password-recovery operations |
| Other action protection remains | Neighboring routes, other methods/mounts and nonstaff identities remain limited; sensitive ID-catalog and unrelated staff writes return 429 |
| Successful actions generate audits | Resident creation, household creation, member addition and batch imports have actor-specific application audit events |

## Validation results

- Unchanged backend baseline: **234 passed**, no failures or skips; see [baseline output](backend-registration-baseline.log).
- Focused backend regression run: **25 passed**, no failures or skips; see [regression output](registration-regression.log).
- Full backend suite (`cd server; npm.cmd test`): **252 passed**, no failures or skips; see [complete test output](backend-registration-tests.log).
- Frontend API and login helper tests (`cd client; node --test tests/api-timeout.test.mjs tests/login-warmup.test.mjs`): **10 passed**, no failures or skips.
- Frontend production build (`cd client; npm.cmd run build`): **passed**. Vite reports a bundle over 500 kB; see [build output](frontend-registration-build.log).

## Deployment

Deploy/restart the backend and deploy the rebuilt frontend. No new environment variables, dependencies, SQL migrations, rate-counter cleanup or database reset are required. Exhausted existing registration counters are ignored by the new exemptions. Existing Resend configuration and provider limits continue to apply; provider rejection still triggers the existing account/ID cleanup and email-specific error handling.

No production Supabase reset, truncation, record modification or real registration email was performed during verification.
