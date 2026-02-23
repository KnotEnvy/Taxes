# Session Recap

Date: 2026-02-23  
Workspace: `D:\Taxes`

## Objective
Build a scalable full-stack baseline to parse, analyze, and categorize bank/credit-card statements for:
- 2024 Sole Proprietorship (Schedule C-aligned categories)
- 2025 C-Corp (Form 1120-aligned categories)

## Incremental Update (P0-1 kickoff, 2026-02-23)

- Added institution parser adapter registry in `apps/api/src/services/parser/institution-adapters.mjs` for:
  - `AMEX`, `BLUEVINE`, `CAPITAL_ONE`, `CASH_APP`, `DISCOVER`, `SPACE_COAST`
  - explicit fallback to `GENERIC_V1` when no adapter is available
- Upgraded parser diagnostics in `apps/api/src/services/parser/statement-parser.mjs`:
  - now emits `parseMethod`, `institutionAdapter`, `fallbackToGeneric`, `parserConfidence`
  - includes quality counters: `droppedNoiseLines`, `candidateLines`, `rawParsedTransactions`, `parsedTransactions`
- Added parser confidence gate in `apps/api/src/services/statement-processor.mjs`:
  - low-confidence parses create `REVIEW_REASON.PARSE_WARNING`
  - parser context is captured in review detail for operator triage
- Updated dashboard statement diagnostics rendering in `apps/web/app.js` to show parse method + confidence.
- Added tests:
  - `tests/parser-adapters.test.mjs` (adapter coverage + fallback behavior)
  - `tests/statement-processor.test.mjs` (parse warning gate behavior)
- Updated validation in `scripts/validate.mjs` with adapter resolution assertions.

Validation snapshot after this increment:
- `node scripts/validate.mjs` passes.
- `node --test tests/*.test.mjs` is blocked in this environment by `spawn EPERM` (known sandbox limitation).

## What Was Implemented

## 1) Application skeleton
- API service in `apps/api/src`
- Worker service in `apps/worker/src`
- Dashboard UI in `apps/web`
- Local dataset ingested from `2024/`

## 2) Core business/data model
- Multi-tenant model (`tenantId` across all business records)
- Business entity profiles with effective ranges (`SOLE_PROP`, `C_CORP`)
- Versioned taxonomies:
- `SCHEDULE_C_2024`
- `FORM_1120_2025`

## 3) Ingestion and parsing
- Recursive PDF scan for local statement import
- Statement fingerprinting by filename/path
- Year mismatch detection (example: Discover 2025 file inside `/2024`)
- PDF text extraction with Flate stream handling and heuristic row parsing

## 4) Classification and review
- Hybrid classification:
- deterministic keyword/account-hint rules
- AI-provider abstraction (mock provider)
- low-confidence review queue
- Manual reclassification endpoint and UI flow
- Audit trail events for processing/review/classification actions

## 5) Rule management and learning
- Tenant/account scoped reusable rules
- Endpoints:
- `GET /v1/rules`
- `POST /v1/rules`
- `DELETE /v1/rules/{id}`
- Optional rule learning on manual resolution/classification:
- `createRuleFromTransaction`
- `ruleScope`
- optional custom `rulePattern`

## 6) Reporting
- Tax summary by year/entity mapping
- CSV export endpoint

## 7) Storage backends
- `file` store (default JSON persistence)
- `postgres` store (optional) with:
- schema in `infra/postgres/schema.sql`
- RLS policies scaffolded
- schema apply script `scripts/db/apply-schema.mjs`

## 8) Validation/tests
- Syntax checks with `node --check`
- Validation script `scripts/validate.mjs` passes
- API smoke tests (`/health`, rule CRUD, review->learned rule flow) pass
- Node built-in test runner may fail in sandboxed environments (`spawn EPERM`)

## Key Files Added/Changed
- `apps/api/src/router.mjs`
- `apps/api/src/services/statement-processor.mjs`
- `apps/api/src/services/parser/statement-parser.mjs`
- `apps/api/src/services/classification/rules-engine.mjs`
- `apps/api/src/services/classification/rule-service.mjs`
- `apps/api/src/store/store-factory.mjs`
- `apps/api/src/store/pg-store.mjs`
- `apps/api/src/store/pg/repositories.mjs`
- `apps/worker/src/index.mjs`
- `apps/web/index.html`
- `apps/web/app.js`
- `apps/web/styles.css`
- `infra/postgres/schema.sql`
- `scripts/db/apply-schema.mjs`
- `scripts/validate.mjs`
- `tests/*.test.mjs`
- `README.md`

## Major Risks/Pitfalls Identified
- Parser quality risk: heuristic parser can extract non-transaction PDF metadata as transactions.
- Learned-rule quality risk: rule learning can produce low-value patterns from noisy descriptions.
- Rule governance gap: no hit-rate/false-positive tracking for created rules yet.
- Postgres scalability risk: current `PostgresStore` uses full-snapshot read/write semantics per mutation.
- Security hardening gap: RLS policy currently allows access when `app.tenant_id` is unset.
- UX guardrail gap: manual prompts allow invalid/non-tax-safe classification decisions without strong validation flow.

## Current Repository State
- Project is runnable in file mode immediately.
- PostgreSQL path is implemented but requires dependency install (`pg`) and DB setup.
- `data/db.json` is currently in a clean initialized state.
