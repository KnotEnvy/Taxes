# Tax Statement Intelligence (Full-Stack Baseline)

This repository now includes a working full-stack baseline for parsing, analyzing, and categorizing statement PDFs for:

- `2024` Sole Proprietorship: Schedule C-aligned taxonomy
- `2025` C-Corp: Form 1120-aligned taxonomy

The implementation is designed as a production architecture baseline with clear service boundaries:

- API service (`apps/api`)
- Worker service (`apps/worker`)
- Web dashboard (`apps/web`)

The baseline runs in file-store mode without external services, and now includes an optional PostgreSQL backend for production-style persistence.

The app now supports two storage backends selected by `TAXES_STORE`:

- `file` (default): JSON file store (`data/db.json`)
- `postgres`: PostgreSQL with schema in `infra/postgres/schema.sql`

## What Is Implemented

- Multi-tenant domain model (`tenantId` scoped on all core records)
- Entity profiles with effective date ranges (`SOLE_PROP`, `C_CORP`)
- Versioned taxonomies:
  - `SCHEDULE_C_2024`
  - `FORM_1120_2025`
- Local statement ingestion scan from `/2024`
- PDF parsing pipeline:
  - text-operator extraction
  - flate stream decompression where possible
  - institution adapter dispatch (`AMEX`, `BLUEVINE`, `CAPITAL_ONE`, `CASH_APP`, `DISCOVER`, `SPACE_COAST`) with generic fallback
  - institution-specific line parsing in adapter layer for all six institutions (dual-date rows, month-name rows, trailing `CR/DB` amount indicators)
  - adapter-aware transaction parsing diagnostics (`parseMethod`, `parserConfidence`, `fallbackToGeneric`, candidate/noise counters)
  - parse warning review gate when parser confidence is low
- Hybrid categorization:
  - deterministic rule engine
  - AI provider abstraction (mock provider included)
  - low-confidence review queue
  - tenant/account-level reusable rules (`/v1/rules`)
  - optional rule learning from manual review decisions
- Year mismatch guardrail (`/2024` folder containing 2025 docs is flagged)
- Tax summary API + CSV export
- Estimated income statement, balance sheet, financial insights, and extended tax detail reporting APIs
- Manual review resolution and manual category overrides
- Audit event logging
- Web dashboard to run end-to-end workflow

## Quick Start

From `D:\Taxes`:

```powershell
node apps/api/src/index.mjs
```

Then open:

```text
http://127.0.0.1:3000
```

Worker (optional, one pass):

```powershell
node apps/worker/src/index.mjs --once
```

Worker (continuous):

```powershell
node apps/worker/src/index.mjs
```

## PostgreSQL Backend

Set environment variables:

```powershell
$env:TAXES_STORE = "postgres"
$env:DATABASE_URL = "postgres://username:password@localhost:5432/taxes"
$env:TAXES_DB_SCHEMA = "public"
```

Install dependencies (needed for `pg`):

```powershell
cmd /c npm install
```

Apply schema:

```powershell
node scripts/db/apply-schema.mjs
```

Run API/worker with PostgreSQL:

```powershell
node apps/api/src/index.mjs
node apps/worker/src/index.mjs --once
```

Run tests:

```powershell
node --test tests/*.test.mjs
```

If your environment blocks Node's spawned test processes, run:

```powershell
node scripts/validate.mjs
```

Parser precision sample harness:

```powershell
node scripts/parser-precision-sample.mjs
```

Real-data parser harness (uses actual statements in `data/db.json`):

```powershell
# institution scorecard from real statements
node scripts/parser-real-data-harness.mjs scorecard --maxPerInstitution=3

# collect real statement lines for labeling
node scripts/parser-real-data-harness.mjs collect --maxPerInstitution=3 --samplePerInstitution=40

# score only labeled rows in data/parser-real-samples.json
node scripts/parser-real-data-harness.mjs score
```

## Current Known Limitations (2026-02-25)

- Real statement extraction is not yet producing usable candidate/transaction rows on sampled statements.
- `data/parser-real-scorecard.json` currently shows zero `candidateLines` and `parsedTransactions` across sampled institutions.
- `data/parser-real-samples.json` is generated for labeling, but starts with unlabeled rows and must be labeled before real precision can be measured.
- Curated parser harness can pass while real-data extraction is still failing; rely on real-data artifacts for go/no-go.

## Main API Endpoints

- `POST /v1/bootstrap`
- `GET /v1/tenants`
- `POST /v1/tenants`
- `POST /v1/entity-profiles`
- `GET /v1/taxonomies`
- `GET /v1/rules`
- `POST /v1/rules`
- `DELETE /v1/rules/{id}`
- `POST /v1/statements/scan-local`
- `POST /v1/statements/upload` (base64 payload)
- `GET /v1/statements`
- `POST /v1/statements/process-pending`
- `POST /v1/statements/{id}/process`
- `GET /v1/statements/{id}/transactions`
- `GET /v1/review-queue`
- `POST /v1/review-queue/{id}/resolve`
- `POST /v1/transactions/{id}/classify`
- `GET /v1/reports/tax-summary?tenantId=...&year=2024`
- `GET /v1/reports/export?tenantId=...&year=2024&format=csv`
- `GET /v1/reports/income-statement?tenantId=...&year=2024`
- `GET /v1/reports/balance-sheet?tenantId=...&year=2024`
- `GET /v1/reports/financial-insights?tenantId=...&year=2024`
- `GET /v1/reports/tax-detail?tenantId=...&year=2024`

## Core Files

- `apps/api/src/index.mjs`
- `apps/api/src/router.mjs`
- `apps/api/src/store/store-factory.mjs`
- `apps/api/src/store/file-store.mjs`
- `apps/api/src/store/pg-store.mjs`
- `apps/api/src/store/pg/repositories.mjs`
- `apps/api/src/services/statement-ingest-service.mjs`
- `apps/api/src/services/statement-processor.mjs`
- `apps/api/src/services/parser/statement-parser.mjs`
- `apps/api/src/services/parser/institution-adapters.mjs`
- `apps/api/src/services/classification/classification-service.mjs`
- `apps/api/src/services/classification/rules-engine.mjs`
- `apps/api/src/services/classification/rule-service.mjs`
- `apps/api/src/services/classification/rule-learning-guardrail.mjs`
- `apps/api/src/domain/taxonomies.mjs`
- `apps/worker/src/index.mjs`
- `apps/web/index.html`
- `apps/web/app.js`
- `infra/postgres/schema.sql`
- `scripts/db/apply-schema.mjs`
- `scripts/parser-precision-sample.mjs`

## Parser Diagnostics

Each processed statement now stores parser diagnostics in `statement.parseDiagnostics`, including:

- `parseMethod` (adapter method id, e.g. `AMEX_V1`, `GENERIC_V1`)
- `institutionAdapter` (resolved institution adapter)
- `fallbackToGeneric` (whether adapter fallback was used)
- `textLines`, `droppedNoiseLines`, `candidateLines`
- `rawParsedTransactions`, `parsedTransactions`
- `parserConfidence` (0..1)

Low parser confidence creates a `PARSE_WARNING` review item so statement QA can catch extraction quality issues before rule learning/classification drift.

## Rule-Learning Guardrail

Learned rule creation from manual resolution/classification is blocked when the related statement has an open `PARSE_WARNING`, unless explicitly approved with:

- `allowRuleFromParseWarning: true`

This prevents noisy parser output from automatically generating tenant rules without operator acknowledgment.

## Data and Storage

- DB JSON: `data/db.json`
- Uploaded/copied statements: `storage/statements/<tenantId>/`

## Production Migration Notes (Next Step)

The current modules already separate concerns for migration:

- Harden PostgreSQL repos from snapshot-sync to targeted query methods by endpoint/use case
- Move HTTP routing to NestJS controllers/services
- Move UI to Next.js App Router while reusing API contracts
- Replace `MockAiCategorizationProvider` with real provider adapter
- Replace heuristic parser with institution adapters + OCR provider
