# Handoff Guide

Date: 2026-02-25  
Audience: fresh engineer/agent taking over this repository.

## 1) What you are inheriting
- A runnable full-stack baseline for statement ingestion, classification, review, and tax reporting.
- Two storage modes:
- `file` (works now)
- `postgres` (implemented, requires dependency install and DB setup)
- Rule management exists and can learn rules from manual review decisions.

## 2) Repository map
- API entrypoint: `apps/api/src/index.mjs`
- Router: `apps/api/src/router.mjs`
- Processing pipeline: `apps/api/src/services/statement-processor.mjs`
- Parser: `apps/api/src/services/parser/statement-parser.mjs`
- Parser adapter registry: `apps/api/src/services/parser/institution-adapters.mjs`
- Rule services: `apps/api/src/services/classification/rule-service.mjs`
- Rule engine: `apps/api/src/services/classification/rules-engine.mjs`
- Worker: `apps/worker/src/index.mjs`
- UI: `apps/web/index.html`, `apps/web/app.js`, `apps/web/styles.css`
- Postgres schema: `infra/postgres/schema.sql`
- Schema apply script: `scripts/db/apply-schema.mjs`
- Validation script: `scripts/validate.mjs`

## 3) Quick start (file mode)
Run from `D:\Taxes`:

```powershell
node apps/api/src/index.mjs
```

Open dashboard:

```text
http://127.0.0.1:3000
```

Worker one-shot:

```powershell
node apps/worker/src/index.mjs --once
```

Validation:

```powershell
node scripts/validate.mjs
```

## 4) Quick start (postgres mode)
Install dependencies:

```powershell
cmd /c npm install
```

Set env vars:

```powershell
$env:TAXES_STORE = "postgres"
$env:DATABASE_URL = "postgres://username:password@localhost:5432/taxes"
$env:TAXES_DB_SCHEMA = "public"
```

Apply schema:

```powershell
node scripts/db/apply-schema.mjs
```

Start API/worker:

```powershell
node apps/api/src/index.mjs
node apps/worker/src/index.mjs --once
```

## 5) Known environment gotchas seen in this session
- `node --test` may fail in sandboxed environments (`spawn EPERM`); use `node scripts/validate.mjs`.
- `git` may fail with dubious ownership unless safe directory is configured.
- Port `3000` may already be occupied by another process in shared environments.

## 6) Critical pitfalls to address first
- Parser adapters now include institution-specific line parsing, but extraction is still heuristic and needs real-statement precision calibration.
- Rule learning can generate low-quality regex if source transaction text is noisy.
- Current Postgres store uses snapshot-style synchronization; not scalable for production throughput.
- RLS policy currently allows access when `app.tenant_id` is unset; tighten for production.

## 6.1) Latest incremental changes (P0-1 + reporting expansion)
- Added institution adapter registry with explicit generic fallback.
- Parser diagnostics now include method + confidence + quality counters.
- `statement-processor` now creates `PARSE_WARNING` review items when parser confidence is low.
- Added test coverage for adapter mapping/fallback and parse-warning gating.
- Added institution-specific line parser behavior for all six institutions while preserving generic fallback for non-matching lines.
- Added learned-rule guardrail that blocks rule creation on open `PARSE_WARNING` unless explicitly approved.
- Added parser precision sample harness: `scripts/parser-precision-sample.mjs`.
- Hardened parser noise filtering to reject metadata-prefixed rows (statement/account/summary/period patterns) and oversized PDF-syntax lines.
- Hardened PDF text extractor to drop text-operator wrapper/object noise while retaining human-readable transaction text.
- Added parser noise regression tests:
  - `tests/statement-parser-institution-lines.test.mjs`
  - `tests/pdf-text-extractor.test.mjs`
- Expanded precision sample coverage with additional negative/noise lines (including `UNKNOWN_BANK`) in `scripts/parser-precision-sample.mjs`.
- Added real-data parser harness script:
  - `scripts/parser-real-data-harness.mjs scorecard`
  - `scripts/parser-real-data-harness.mjs collect`
  - `scripts/parser-real-data-harness.mjs score`
- Added CMap-aware PDF text decoding path in `apps/api/src/services/parser/pdf-text-extractor.mjs` to improve real statement text reconstruction.
- Real-data scorecard currently reports zero candidate/parsed rows on sampled statements for all institutions, indicating extraction coverage gaps on real PDFs still need to be solved before precision targets are meaningful.
- Added report service builders for income statement, balance sheet, financial insights, and tax detail:
  - `buildIncomeStatement`
  - `buildBalanceSheet`
  - `buildFinancialInsights`
  - `buildTaxDetailBreakdown`
- Added API routes:
  - `GET /v1/reports/income-statement`
  - `GET /v1/reports/balance-sheet`
  - `GET /v1/reports/financial-insights`
  - `GET /v1/reports/tax-detail`
- Extended dashboard UI with report panels for those endpoints (`apps/web/index.html`, `apps/web/app.js`, `apps/web/styles.css`).
- Added deterministic report aggregation tests in `tests/report-service.test.mjs`.

## 7) Decision log to preserve
- Product priority: tax-ready output first, analytics second.
- Categorization strategy: deterministic rules first, AI fallback.
- Review policy: low-confidence items require manual review.
- Tenant model target: shared DB + tenant isolation.
- Intake scope for now: PDF upload/scan first, bank APIs later.

## 8) First 90 minutes for a fresh agent
1. Run `node scripts/validate.mjs` and confirm clean startup.
2. Start API and bootstrap tenant via UI or `POST /v1/bootstrap`.
3. Scan `/2024`, process 1-3 statements, inspect review queue.
4. Create one manual rule and confirm it influences subsequent processing.
5. Inspect rule quality and identify any learned-rule noise.
6. Choose the next sprint item from `backlog.md` and begin implementation.

## 9) Immediate next target recommended
Continue `P0-1` in `backlog.md`: tune adapter heuristics using real sampled statement lines and capture measured precision results per institution.  
Reason: adapter-specific parsing exists for all target institutions, but precision acceptance criteria are not yet measured/verified.

## 10) Current blockers snapshot (must resolve next)
- Real-data parser scorecard is still zeroed across sampled institutions:
  - Artifact: `data/parser-real-scorecard.json`
  - Symptom: `candidateLines=0`, `parsedTransactions=0`, `parserConfidence=0` in sampled statements.
- Real-data sample file currently contains only unlabeled rows:
  - Artifact: `data/parser-real-samples.json`
  - Symptom: `labelStatus=UNLABELED` for all rows, no precision/recall can be computed yet.
- Curated sample harness passes, but does not represent real PDFs:
  - Command: `node scripts/parser-precision-sample.mjs` (passes)
  - Risk: false confidence unless real-data scorecard and labeled precision improve.
- `node --test tests/*.test.mjs` may fail in sandbox environments with `spawn EPERM`; use targeted tests and `node scripts/validate.mjs`.

## 11) Next-session prompt location
- Use `next-session-prompt.md` as the copy-paste prompt for the next LLM handoff.
