# Barangay Iba document system — implementation and verification

Prepared 31 October 2026, Asia/Manila. All changes are local to this repository. No production migration was applied, no resident data was changed remotely, and no real notification was sent.

## A. Existing system findings

The application uses React 19, Vite and React Router's data router, with a separate Express API. Authentication uses the existing JWT/session system and live user roles from Supabase. The backend uses a private service-role Supabase client and existing audit context. Resend is called through the existing mailer. Resident registration remains administrator controlled; no public signup system was introduced.

The working repository was inspected before editing. A read-only check of the connected database confirmed the existing identity fields (`suffix`, `sex`, `civil_status`, `citizenship`, `residency_since`, etc.) and the request fields. That check returned column names, not resident records. The three requested document-related tables were absent. Database function bodies, policies and full constraints were inspected from repository migrations, rather than represented as a complete live schema export.

Existing `users`, `requests`, `request_timeline`, `id_requests`, `notifications`, `case_history_events`, and `audit_logs` are reused. Historical `clearances` records are preserved. ID pickup appointments remain separate from ID document applications.

Confirmed initial defects included missing `SelectInput` imports in `AdminEvents.jsx` and `SuggestionsPage.jsx`; no custom router error screen; invalid use of Effect Events as event handlers in authentication; ref writes during modal rendering; menu state resets in effects; unsafe date formatting; and an unhandled initial resident-registry loading failure. The previous clearance URL always returned an unavailable-template error. The earlier duplicate-ID guard omitted confirmed and rescheduled appointments.

After the import correction, the baseline production build and 190 backend tests passed. Baseline lint reported 25 errors and 36 warnings. A successful build alone did not detect the missing JSX component imports.

## B. Implementation summary

### Resident application and profile

- Five document types: Barangay Identification Card, Certificate of Indigency, Barangay Clearance, Barangay Business Clearance, and Certificate of Residency/general certification.
- Conditional business and indigency forms, purpose, copies, inline validation, review confirmation, request references, tracking, cancellation before review, and corrections after a revision request.
- Prefilled resident details remain controlled by staff. Residents can upload, replace, preview or remove their own profile photograph. Staff can edit verified profile details and manage a request-specific photograph.
- Supporting images can be uploaded and removed before approval, including when correcting an application.
- JPEG, PNG and WebP uploads are checked by signature and decoded with Sharp. Limits are 5 MB, one frame, 160–6000 pixels per side and 16 megapixels. Images are re-encoded as PNG at up to 1200 pixels per side, stripping metadata.
- Replaced profile images are removed when unreferenced. Images used by historical approved snapshots are retained privately.

### Request processing

The new flow is `submitted → under_review → approved → document_prepared → ready_for_pickup → claimed`, with explicit revision, rejection and permitted cancellation paths. Revisions return to submitted. Legacy acknowledged/processing requests enter under review through an explicit staff action. Legacy completed records retain that value and are never assumed to have been physically claimed.

The administrative queue includes status totals, resident/reference search, document/status/date filters, profile and supporting-image views, verification checks, resident-facing responses and history. Rejection requires a reason; revision requires instructions. Approval requires the appropriate staff verification and an approved template.

Status updates, numbering, version registration and history use database transactions with row locks and expected request versions. A new portrait or supporting image also changes the request version where appropriate. Conflicting updates fail and require refresh.

Approval freezes a versioned resident snapshot, document-specific values, selected photo, verified wording, issue date and expiration. Subsequent profile changes do not alter that issuance. Names include suffixes; age is calculated at the chosen issue date.

### Editable Word files

`docx` generates actual editable paragraphs, tables, graphics and signature lines. Certificates use A4 portrait; ID pages use 85.6 × 54 mm dimensions. Separate copies use explicit section breaks. Both supplied logos are retained in the header, without a center watermark. No handwritten signature or physical seal is synthesized.

Approved requests can generate a draft, download Word files, upload an edited `.docx`, preview a selected version, and explicitly mark a reviewed version prepared. All versions are retained. A generated draft is rebuilt without its draft notice when prepared. For an uploaded revision, staff must review its numbering, dates, wording and draft notice before confirming preparation. Downloaded edits never update the database automatically.

Word uploads are limited to 10 MB and checked for ZIP/OOXML structure, valid XML, expanded content size, unsafe paths, macros, embedded executables and external relationships. The preview renders the actual saved Word file inside a sandboxed frame. Finalized versions are immutable.

The legacy `/api/requests/document/:requestId/clearance` URL now serves a prepared final `.docx` to authorized staff only. Residents cannot download internal Word files. General version downloads use `/api/documents/files/:id` with the same live role protection.

### Templates, numbering and notifications

Five proposed version-one templates are seeded as drafts, with no official's name, approval or invented validity period. A super administrator can create and approve a new template version through the template editor. Approved wording is immutable; future changes require another version.

The supported numbering stage is request approval. The approved configuration supplies an uppercase prefix; the format is `PREFIXYYYY-0001`, with a minimum four-digit sequence. Counters are serialized by prefix/year, including when two document types share a prefix. A unique request index provides an additional duplicate-number check. This reserves a number; signing, sealing, pickup and claiming are separate actions.

Before the first approval, reconcile the prefix/year counter with the barangay's manual issuance ledger. Existing paper numbers cannot be inferred from these database tables. Staff must seed the last-used value (without decreasing any existing counter), or approve a distinct new prefix. Database uniqueness alone cannot prevent a collision with a paper issuance that was never recorded in the portal.

The Notify Resident action supports received, revision, rejection, approval, pickup, reminder and custom messages. Staff see the recipient and message before sending. Each attempt is logged with actor, request, recipient, provider ID, status and a safe error code. Portal status changes do not depend on email success. Standard messages omit tax identifiers and confidential documents.

Both database and provider idempotency keys protect repeated sends. Explicit retries use the original reviewed message and key, a version check on the attempt, a 15-second cooldown and a 23-hour eligibility window. Older or stale-status messages require a new preview. Resend documents a 24-hour key lifetime. Provider acceptance is displayed as accepted, never as delivery confirmation. Existing email consumers were updated to use `accepted`; SMS retains its separate existing delivery contract. [Resend idempotency documentation](https://resend.com/changelog/idempotency-keys).

### Principal files and dependencies

Core backend files are `server/src/routes/documents.js`, `documentRules.js`, `documentStorage.js`, `documentNotifications.js`, and `wordDocuments.js`. Existing request/admin routes, startup readiness, safe error handling and mailer consumers were extended.

Core frontend files are `DocumentApplication.jsx`, `DocumentQueue.jsx`, `DocumentRequestDetail.jsx`, `ResidentPhoto.jsx`, `WordPreview.jsx`, `RouteError.jsx`, and the existing resident/admin request and settings pages. Shared auth/review/toast hooks were separated from provider components, and affected consumers updated. Loading callbacks now declare their dependencies. JSX reference checks are enabled without disabling lint rules.

Added runtime dependencies: `docx`, `sharp`, `jszip`, `fast-xml-parser`, and client `docx-preview`. Added development tooling: Playwright and the React JSX lint plugin. Compatible dependency updates were applied through the lockfiles to address audit findings. Server Node minimum is now 20.9 because the patched Sharp release requires it; the work was tested on Node 22.15.0. Do not deploy the new server on Node 18. [Sharp installation requirements](https://sharp.pixelplumbing.com/install/), [docx documentation](https://docx.js.org/).

## C. Error fixes and verification

| Problem | Correction | Evidence |
| --- | --- | --- |
| Undefined `SelectInput` | Imported the existing shared export in both affected pages; enabled JSX reference linting | Lint and browser route sweep |
| Unhandled route rendering failures | Added a root router error element with retry, dashboard link and safe reference; diagnostics stay in development logs | Browser route sweep and code inspection |
| Invalid auth hook usage | Replaced Effect Events exposed to handlers with callbacks; boot profile request has cleanup | Lint and browser login |
| Modal/render and menu effect defects | Moved callback ref updates into effects; made menu state follow the active path | Lint and browser navigation |
| Invalid historical date crashes | Added safe date checks and Manila input validation | Executable date regression test |
| Resident registry API rejection | Added a recoverable error state and retry | Code inspection, lint and route rendering |
| Admin dialog closed during refresh | Queue reload no longer unmounts the document dialog | Complete browser request-processing scenario |
| Old duplicate-ID guard | Added confirmed/rescheduled appointment states | Executed PostgreSQL test |
| Closed requests counted as active | Updated resident/admin dashboard active counts | Code inspection and regression checks |
| Internal server error exposure | Return a generic server-error message and reference; retain diagnostics server-side | Backend regression suite |
| Preview merged identical copy sections | Used explicit Word section breaks and corrected preview section handling | All five browser Word preview checks |

The new SQL tests also caught a shared-trigger field-access error during implementation. It was fixed, and the migration now installs twice and passes the transaction tests. Intermediate browser failures and test-selector corrections were resolved before the final run; no failing checks were disabled.

## D. Database deployment and recovery

1. Back up the database and private storage. Confirm the existing migration chain through `supabase-v4-phase10-5-data-security.sql` is already installed.
2. Review and apply **only** `server/supabase-v4-phase11-documents.sql` for this upgrade. It is transactional and additive; it does not reset tables or rewrite historical request statuses. It replaces the known legacy request-status enum check and extends the existing duplicate guard.
3. Run `server/verify-phase11-documents.sql`. Check readiness, private bucket settings, service-only RPC access, unique control numbers, template states and legacy anomalies. Status and copy constraints are initially `NOT VALID` to preserve anomalous historical rows; review those rows before separately validating the constraints.
   Reconcile `document_number_counters` with the official ledger before approving any template for issuance. The counter's `document_type` key stores the approved prefix; `issue_year` stores the year and `last_value` the last-used sequence.
4. Deploy the corresponding API and client together. Startup now requires `bgy_phase11_ready()`; new code intentionally refuses to start on an old schema.
5. Approve official template versions only after staff confirm wording and policies. Test a synthetic resident in staging before accepting real applications.

The migration adds five tables: `document_templates`, `document_number_counters`, `generated_documents`, `request_attachments`, and `notification_logs`. It extends `users` and `requests`, adds foreign keys/indexes and service-only RPC grants, and provisions the private `barangay-documents` bucket. Existing resident identity fields are reused.

If migration execution fails before commit, PostgreSQL rolls it back. If a release must be withdrawn after commit, stop document writes and retain the additive schema, files, counters, snapshots and history. Restore a tested application release that understands the new statuses, or keep the document workflow in maintenance while repairing forward. Do not restore the old four-state API over new active requests or drop document tables/counters as a shortcut. Database/storage restoration must be coordinated from the same backup point to avoid broken file references or reissued numbers.

No destructive down-migration is supplied because reverting after issuance must preserve historical records. No production migration was executed in this session.

## E. Test results and limits

Final checks passed: `npm run lint` (zero errors and warnings), `npm run build`, all **199 backend tests**, and all **six Playwright scenarios**. There are no remaining failing automated tests. The retained local backend log is `current-tests.txt`; Playwright writes `artifacts/browser-report/index.html` and test results locally.

Backend coverage includes existing authentication, resident access, census/registration SQL, admin invitations, audit contracts, concern limits/history, voting/projects, borrowing, reporting and route contracts, plus new document tests. The new HTTP tests execute real JWT verification, live-role middleware, ownership checks, photo decoding/upload/replacement/removal, staff-only downloads and rejected forged sessions against an injected synthetic database. External network calls are explicitly blocked in that test.

The entire forward migration executes against PostgreSQL through PGlite, twice, with controlled prerequisite fixtures. Tests exercise revision/resubmission, rejection requirements, stale versions, unique numbers, frozen snapshots, immutable files/templates, request-image removal and locked uploads. PGlite runs in-process; this is not a multi-connection concurrency stress test of the hosted Supabase instance.

All five document types are generated using synthetic data. Tests inspect the ZIP/XML, editable paragraphs/tables, exact embedded test photo, logos, control number, dates, business details, copies and absent watermark. Long names and multiline addresses are exercised structurally. Browser preview tests render each format and verify copy sections/images; the standard ID sample also fits its configured preview height. Native Microsoft Word/LibreOffice rendering and printer output were unavailable, so final pagination, page borders, long-name ID fitting and physical print calibration still need staff review in Word.

Playwright runs the actual local Vite application in installed Chrome with synthetic API responses. It sweeps 43 public/resident/admin routes, tests resident login and five conditional applications, revisions, photo validation/mobile layout, and admin review → approval → Word generation/download/revised upload/preview → preparation → pickup notification → claim. It separately renders all five generated Word samples. It does not prove a deployed browser-to-Supabase workflow. Other modules received route-rendering coverage and their existing automated tests; complete live CRUD of every module was not executed.

Notification tests cover success/acceptance, invalid/missing email, provider rejection, timeout, retry, stale previews, duplicate clicks and concurrent sends against controlled adapters. No real email recipient was contacted. Provider delivery webhooks are not implemented, so actual delivery is unverified.

Dependency checks: server full audit and client production-only audit pass with zero findings. The client development toolchain still reports seven moderate findings through Minimatch/ESLint packages with no compatible automated fix. They are not included in the production bundle. The production build retains a large-main-chunk warning (approximately 1.16 MB before gzip); Word preview is loaded separately. These warnings were not suppressed.

## F. Deployment checklist

- Use a compatible Node runtime and run `npm ci` separately in `server` and `client` using the checked-in lockfiles.
- Retain existing server-only Supabase service key/JWT configuration, allowed client origins and frontend API URL. Never place the service key or Resend key in Vite variables.
- Apply the Phase 11 migration and verify `barangay-documents` remains private. Do not add public storage policies to bypass backend retrieval.
- Verify existing Resend key, verified-domain sender and timeout settings. Test only an authorized controlled recipient in staging. Confirm portal status survives a failed email.
- Create approved template versions through the super-administrator template editor. Draft seed templates cannot issue documents.
- Review proposed business requirements, optional identifiers, selected portraits, control prefixes, validity, official contact and pickup wording.
- Run the backend suite, frontend lint/build and browser scenarios. Generate a synthetic document in staging, download/edit/upload it, review it in Word, prepare it, mark pickup and record claim.
- Confirm backup, retention and recovery procedures, especially old portraits referenced by approved snapshots and staged file cleanup failures.
- Confirm physical signing/sealing procedures separately from the portal's prepared/pickup statuses.

## G. Outstanding client decisions

Staff must approve the exact wording for every document, the authorized official and designation, the signature/dry-seal process, the supported approval-stage numbering rule, prefix formats and starting ledger counters, document validity, indigency/background verification criteria, business required fields, pickup/contact policies, and data retention. Initial seed templates intentionally remain drafts until those decisions are recorded.

The synthetic Word samples and preview screenshots under `artifacts/` are review aids, not approved official documents. The supplied document subjects, sample portraits, control numbers and official's name were not inserted into application templates.

## Changed-file inventory

See `CHANGED_FILES.txt` for the complete source/artifact inventory from this local change. Changes were not committed or deployed.
