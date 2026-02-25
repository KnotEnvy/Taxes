import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ENTITY_TYPES, REVIEW_REASON, REVIEW_STATUS, TAXONOMY_IDS } from "../apps/api/src/domain/constants.mjs";
import { getTaxonomyForEntityYear } from "../apps/api/src/domain/taxonomies.mjs";
import { ClassificationService } from "../apps/api/src/services/classification/classification-service.mjs";
import {
  buildPatternFromTransaction,
  createTenantRule,
  listTenantRules,
} from "../apps/api/src/services/classification/rule-service.mjs";
import { ensureLearnedRuleAllowed } from "../apps/api/src/services/classification/rule-learning-guardrail.mjs";
import {
  hasInstitutionAdapter,
  listSupportedInstitutions,
  resolveParserAdapter,
} from "../apps/api/src/services/parser/institution-adapters.mjs";
import {
  detectFolderYearMismatch,
  inferStatementPeriod,
  parseTransactionLineByInstitution,
} from "../apps/api/src/services/parser/statement-parser.mjs";

async function run() {
  const scheduleC = getTaxonomyForEntityYear(ENTITY_TYPES.SOLE_PROP, 2024);
  assert.ok(scheduleC);
  assert.equal(scheduleC.id, TAXONOMY_IDS.SCHEDULE_C_2024);

  const form1120 = getTaxonomyForEntityYear(ENTITY_TYPES.C_CORP, 2025);
  assert.ok(form1120);
  assert.equal(form1120.id, TAXONOMY_IDS.FORM_1120_2025);

  const classifier = new ClassificationService();
  const decision = await classifier.classify({
    transaction: {
      description: "DIRECT DEPOSIT PAYROLL",
      rawLine: "01/12 DIRECT DEPOSIT PAYROLL 500.00",
    },
    context: {
      taxonomyId: TAXONOMY_IDS.FORM_1120_2025,
      accountLabel: "payroll 0378",
    },
  });
  assert.equal(decision.categoryCode, "wages");
  assert.equal(decision.needsReview, false);

  const db = { rules: [] };
  createTenantRule({
    db,
    tenantId: "tenant_validation",
    categoryCode: "office_expense",
    pattern: "\\bamazon\\b",
    priority: 1000,
  });
  const learnedDecision = await classifier.classify({
    transaction: {
      description: "AMAZON MARKETPLACE PMTS",
      rawLine: "01/10 AMAZON MARKETPLACE PMTS 22.19",
    },
    context: {
      taxonomyId: TAXONOMY_IDS.SCHEDULE_C_2024,
      accountLabel: "checking 3190",
      customRules: listTenantRules({ db, tenantId: "tenant_validation" }),
    },
  });
  assert.equal(learnedDecision.categoryCode, "office_expense");

  const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const discoverPath = path.join(workspaceRoot, "2024", "Discover2024", "Discover-AccountActivity-20251012.pdf");
  const period = inferStatementPeriod(discoverPath);
  assert.equal(period.year, 2025);
  assert.equal(detectFolderYearMismatch(path.join(workspaceRoot, "2024"), discoverPath, period.year), true);

  for (const institution of listSupportedInstitutions()) {
    assert.equal(hasInstitutionAdapter(institution), true);
    const adapter = resolveParserAdapter(institution);
    assert.equal(adapter.fallbackToGeneric, false);
    assert.equal(adapter.institution, institution);
    assert.match(adapter.method, /_V1$/);
  }

  const fallbackAdapter = resolveParserAdapter("UNKNOWN_BANK");
  assert.equal(fallbackAdapter.fallbackToGeneric, true);
  assert.equal(fallbackAdapter.method, "GENERIC_V1");

  const parserSamples = [
    {
      institution: "AMEX",
      line: "01/12 01/13 ONLINE PAYMENT RECEIVED 125.00 CR",
      postedDate: "2024-01-13",
      amount: -125,
    },
    {
      institution: "DISCOVER",
      line: "02/01 02/02 WALMART SUPERCENTER #1234 84.27",
      postedDate: "2024-02-02",
      amount: 84.27,
    },
    {
      institution: "CASH_APP",
      line: "Jan 14 CASH CARD STARBUCKS 6.45",
      postedDate: "2024-01-14",
      amount: 6.45,
    },
  ];
  for (const sample of parserSamples) {
    const parsed = parseTransactionLineByInstitution({
      line: sample.line,
      statementYear: 2024,
      institution: sample.institution,
    });
    assert.ok(parsed);
    assert.equal(parsed.postedDate, sample.postedDate);
    assert.equal(parsed.amount, sample.amount);
  }

  const parserNoiseLine = parseTransactionLineByInstitution({
    line: "STATEMENT PERIOD: 03/01/2024 - 03/31/2024 1,250.00",
    statementYear: 2024,
    institution: "UNKNOWN_BANK",
  });
  assert.equal(parserNoiseLine, null);

  const learnedPattern = buildPatternFromTransaction({
    description: "Amazon Marketplace PMTS",
  });
  assert.equal(typeof learnedPattern, "string");
  const learnedRegex = new RegExp(learnedPattern, "i");
  assert.equal(learnedRegex.test("AMAZON MARKETPLACE"), true);

  assert.throws(
    () =>
      ensureLearnedRuleAllowed({
        db: {
          reviewQueue: [
            {
              tenantId: "tenant_validation",
              statementId: "stmt_1",
              reason: REVIEW_REASON.PARSE_WARNING,
              status: REVIEW_STATUS.OPEN,
            },
          ],
        },
        tenantId: "tenant_validation",
        transaction: { statementId: "stmt_1" },
      }),
    /PARSE_WARNING/i,
  );
  assert.doesNotThrow(() =>
    ensureLearnedRuleAllowed({
      db: {
        reviewQueue: [
          {
            tenantId: "tenant_validation",
            statementId: "stmt_1",
            reason: REVIEW_REASON.PARSE_WARNING,
            status: REVIEW_STATUS.OPEN,
          },
        ],
      },
      tenantId: "tenant_validation",
      transaction: { statementId: "stmt_1" },
      allowParseWarningOverride: true,
    }),
  );
}

try {
  await run();
  // eslint-disable-next-line no-console
  console.log("Validation passed.");
} catch (error) {
  // eslint-disable-next-line no-console
  console.error("Validation failed:", error);
  process.exitCode = 1;
}
