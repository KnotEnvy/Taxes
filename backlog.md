# Backlog

Date: 2026-02-23  
Priority legend: P0 = critical, P1 = high, P2 = medium, P3 = later

## P0-1: Parser reliability upgrade (institution adapters)
Goal: Stop noisy/non-transaction extraction and get deterministic, bank-specific parsing.
Status: IN_PROGRESS (started 2026-02-23)

Scope:
- Build parser adapter interface by institution (`AMEX`, `BLUEVINE`, `CAPITAL_ONE`, `CASH_APP`, `DISCOVER`, `SPACE_COAST`)
- Add parser confidence/quality metrics per statement
- Fallback to generic parser only when adapter unavailable

Completed in current increment:
- Added institution adapter registry with explicit fallback: `apps/api/src/services/parser/institution-adapters.mjs`
- Parser now emits adapter + quality diagnostics (`parseMethod`, `parserConfidence`, candidate/noise counters)
- Processor now opens `PARSE_WARNING` review items on low parser confidence
- Added coverage for adapter mapping/fallback and parse warning gate
- Added institution-specific line parser hooks for all six institutions with generic fallback for non-matching lines
- Added learned-rule guardrail for parse warnings (`allowRuleFromParseWarning` required to bypass)
- Added parser precision sample harness script with per-institution threshold reporting
- Added parser metadata hardening to block statement-summary/date/period prefix lines from generic and adapter parsing
- Added parser line-length + PDF-syntax noise filtering guardrails for candidate gating and parsed-line sanitation
- Added extractor filtering for text-operator/object noise and regression tests (`tests/pdf-text-extractor.test.mjs`)
- Expanded precision harness with stronger negative samples including metadata-prefixed and PDF-operator-like noise lines
- Added real-data harness script for statement-backed scorecards and labeling workflow:
  - `scripts/parser-real-data-harness.mjs scorecard`
  - `scripts/parser-real-data-harness.mjs collect`
  - `scripts/parser-real-data-harness.mjs score`

Remaining to hit full acceptance:
- Calibrate/iterate institution parser heuristics against real statement samples for precision target
- Measure precision on sampled statements and record institution-level scorecard (target >=95% row precision)
- Replace curated precision samples with real sampled statement exports and track trend over time
- Restore real-statement transaction extraction coverage (current real-data scorecard shows zero candidate/parsed rows on sampled statements across institutions)

Acceptance criteria:
- At least 95% row precision on manually sampled statements per institution
- No learned rules generated from document metadata lines
- Diagnostics include parse method and confidence score

Pitfalls to avoid:
- Shipping one regex-heavy generic parser for all institutions
- Mixing OCR text and native text without line provenance metadata

## P0-2: Rule safety and governance
Goal: Prevent bad learned rules from polluting future classification.

Scope:
- Rule preview/simulation endpoint before activation
- Rule hit/miss counters and confidence drift metrics
- Rule status lifecycle: `draft`, `active`, `disabled`
- Require minimum-quality checks before auto-activating learned rules

Acceptance criteria:
- Every active rule has provenance metadata and last-hit timestamp
- Rules can be rolled back quickly with deterministic impact analysis
- UI shows last 30-day hit count for each rule

Pitfalls to avoid:
- Auto-enabling rules generated from a single noisy transaction
- Allowing broad regex patterns without guardrails

## P0-3: Harden tenant isolation for production
Goal: Close security gaps before SaaS exposure.

Scope:
- Require tenant context (`app.tenant_id`) on every DB session
- Remove permissive RLS "allow when tenant setting is null" path in prod profile
- Add integration tests proving cross-tenant access is blocked

Acceptance criteria:
- Cross-tenant read/write attempts fail by policy
- Service startup fails fast if tenant context middleware is missing in prod mode

Pitfalls to avoid:
- Relying only on app-layer filters without DB enforcement
- Keeping permissive RLS policy in production configs

## P1-1: Replace Postgres snapshot-sync with targeted repositories
Goal: Improve performance and correctness under concurrent workloads.

Scope:
- Replace full table snapshot read/write with operation-specific SQL methods
- Add pagination/filtering at query layer
- Add transaction boundaries only where required

Acceptance criteria:
- No full-table rewrites during normal API operations
- Throughput and latency materially improved under load test

Pitfalls to avoid:
- Introducing inconsistent write paths between file and postgres backends
- Losing idempotency guarantees for statement processing

## P1-2: Classification quality feedback loop
Goal: Improve model/rule precision over time with measurable outcomes.

Scope:
- Track confusion matrix by category from manual overrides
- Suggested-rules queue from repeated overrides
- Add confidence calibration report by source institution

Acceptance criteria:
- Weekly quality report endpoint/UI
- Suggested rules created only after repeated consistent overrides

Pitfalls to avoid:
- Treating one-off overrides as strong training signals
- Ignoring institution/account context in suggestions

## P1-3: Audit and compliance hardening
Goal: Make bookkeeping decisions defensible for tax review.

Scope:
- Immutable audit record strategy
- Include before/after values for manual and automated classification changes
- Exportable audit reports for a tax year

Acceptance criteria:
- Every classification/reporting action is traceable
- Audit export includes actor, timestamp, reason, and changed fields

Pitfalls to avoid:
- Logging without linkage to transaction/rule version
- Mutable audit rows without tamper evidence

## P1-4: Financial statement and tax-insight reporting
Goal: Go beyond expense-only summaries with operator-facing financial statement views.
Status: IN_PROGRESS (started 2026-02-24)

Completed in current increment:
- Added report APIs: `/v1/reports/income-statement`, `/v1/reports/balance-sheet`, `/v1/reports/financial-insights`, `/v1/reports/tax-detail`
- Added dashboard panels and rendering logic for income statement, balance sheet, KPI insights, and tax detail
- Added report aggregation test coverage (`tests/report-service.test.mjs`)

Remaining to hit full acceptance:
- Replace activity-derived balance estimates with true opening/closing balance support per account
- Separate true revenue/income inflows from transfer/refund credits using stronger account + category metadata
- Add period-over-period comparison and export support for new report endpoints

Acceptance criteria:
- Dashboard shows income statement, balance-sheet view, financial KPIs, and tax-detail breakdown for selected tenant/year
- API responses include assumptions/limits so estimated values are auditable
- Report service has deterministic tests for entity-type-specific tax estimates and balance bucket logic

Pitfalls to avoid:
- Treating estimated activity-based balances as audited book balances
- Assuming every statement credit is taxable revenue without transfer disambiguation

## P2-1: Frontend migration and UX maturation
Goal: Move from prototype dashboard to production operator UI.

Scope:
- Migrate to Next.js App Router and typed API client
- Replace prompt-based manual flows with forms/modals
- Add transaction detail drill-down and per-statement QA workflow

Acceptance criteria:
- No browser prompts in core workflows
- Rule creation and review resolution have validation and previews

Pitfalls to avoid:
- Rebuilding API contracts while migrating UI
- Shipping a pretty UI without operator safeguards

## P2-2: OCR provider integration
Goal: Robustly handle scanned statements and low-text PDFs.

Scope:
- Implement OCR provider adapter (Textract first)
- Store OCR confidence and page-level artifacts
- Retry/dead-letter handling for OCR jobs

Acceptance criteria:
- OCR path can parse low-text PDFs with measurable success rates
- Operator can inspect OCR-derived lines for dispute resolution

Pitfalls to avoid:
- Mixing OCR and native extraction output without source tagging
- Ignoring OCR costs and rate limits in worker design

## P3-1: SaaS onboarding and billing hooks
Goal: Make the platform tenant-onboardable and monetizable.

Scope:
- Tenant onboarding flow and role-based invitations
- Usage metering hooks (statements, pages, transactions)
- Billing provider integration points

Acceptance criteria:
- New tenant can self-onboard and run first statement import
- Usage metrics available per billing period

Pitfalls to avoid:
- Entangling billing logic directly inside core ingest/classification services
- Missing idempotency keys for billable events

## Suggested next implementation order
1. P0-1 Parser reliability
2. P0-2 Rule governance
3. P0-3 Tenant isolation hardening
4. P1-1 Targeted Postgres repositories
5. P1-2 Quality feedback loop

