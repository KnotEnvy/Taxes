# Next Session Prompt

Use this prompt for the next LLM session:

```text
You are continuing work in D:\Taxes.

Primary objective:
Fix real-statement extraction so parser coverage is non-zero on actual PDFs, then produce measurable real-data precision metrics by institution.

Current facts to trust:
- Curated harness passes: node scripts/parser-precision-sample.mjs
- Real-data scorecard is failing coverage: data/parser-real-scorecard.json shows candidateLines=0 and parsedTransactions=0 across sampled institutions.
- Real sample file exists but is unlabeled: data/parser-real-samples.json
- Reference docs: handoff.md, backlog.md (P0-1), README.md (Current Known Limitations).

Required workflow:
1) Run:
   - node scripts/parser-real-data-harness.mjs scorecard --maxPerInstitution=3 --output=data/parser-real-scorecard.json
2) Debug and improve extraction/parser pipeline until scorecard is non-zero for at least 4 institutions:
   - likely touch apps/api/src/services/parser/pdf-text-extractor.mjs
   - and/or apps/api/src/services/parser/statement-parser.mjs
3) Add/update regression tests for any fix.
4) Regenerate samples:
   - node scripts/parser-real-data-harness.mjs collect --maxPerInstitution=3 --samplePerInstitution=40 --output=data/parser-real-samples.json
5) Auto-apply safe initial labels in parser-real-samples where confidence is obvious:
   - metadata rows -> expectedTransaction=false
   - parser-predicted transaction rows with clear date+amount+merchant -> expectedTransaction=true
   - leave ambiguous rows unlabeled
6) Run:
   - node scripts/parser-real-data-harness.mjs score --output=data/parser-real-samples.json
7) Update docs:
   - handoff.md
   - backlog.md (P0-1)
   - README.md (Known Limitations)

Acceptance criteria for this session:
- Real-data scorecard shows non-zero candidate/parsed rows for most sampled institutions.
- Labeled sample precision report is produced (not "No labeled samples found").
- Tests and validate pass:
  - node scripts/validate.mjs
  - plus targeted parser tests.

Constraints:
- Do not revert unrelated user changes.
- Keep changes minimal and focused on P0-1 real-data extraction reliability.
```

