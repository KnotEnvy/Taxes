import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ENTITY_TYPES, TAXONOMY_IDS } from "../apps/api/src/domain/constants.mjs";
import { getTaxonomyForEntityYear } from "../apps/api/src/domain/taxonomies.mjs";
import { ClassificationService } from "../apps/api/src/services/classification/classification-service.mjs";
import { createTenantRule, listTenantRules } from "../apps/api/src/services/classification/rule-service.mjs";
import {
  hasInstitutionAdapter,
  listSupportedInstitutions,
  resolveParserAdapter,
} from "../apps/api/src/services/parser/institution-adapters.mjs";
import { detectFolderYearMismatch, inferStatementPeriod } from "../apps/api/src/services/parser/statement-parser.mjs";

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
