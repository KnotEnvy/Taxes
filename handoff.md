# Handoff Guide

Date: 2026-02-23  
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
- Parser can extract non-transaction metadata lines.
- Rule learning can generate low-quality regex if source transaction text is noisy.
- Current Postgres store uses snapshot-style synchronization; not scalable for production throughput.
- RLS policy currently allows access when `app.tenant_id` is unset; tighten for production.

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
Start with `P0-1` in `backlog.md`: institution-specific parser adapters and parser confidence gates.  
Reason: this reduces downstream errors in classification, rule learning, and tax outputs.
