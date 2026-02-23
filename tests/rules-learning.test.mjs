import test from "node:test";
import assert from "node:assert/strict";
import { TAXONOMY_IDS } from "../apps/api/src/domain/constants.mjs";
import { ClassificationService } from "../apps/api/src/services/classification/classification-service.mjs";
import {
  buildPatternFromTransaction,
  createTenantRule,
  listTenantRules,
} from "../apps/api/src/services/classification/rule-service.mjs";

test("tenant rule overrides default keyword rule when priority is higher", async () => {
  const db = { rules: [] };
  createTenantRule({
    db,
    tenantId: "tenant_1",
    categoryCode: "office_expense",
    pattern: "\\bamazon\\b",
    priority: 1000,
    confidence: 0.99,
  });

  const service = new ClassificationService();
  const decision = await service.classify({
    transaction: {
      description: "AMAZON MARKETPLACE",
      rawLine: "01/02 AMAZON MARKETPLACE 54.21",
    },
    context: {
      taxonomyId: TAXONOMY_IDS.SCHEDULE_C_2024,
      accountLabel: "checking 3190",
      customRules: listTenantRules({ db, tenantId: "tenant_1" }),
    },
  });

  assert.equal(decision.categoryCode, "office_expense");
});

test("buildPatternFromTransaction creates reusable regex pattern", () => {
  const pattern = buildPatternFromTransaction({
    description: "Amazon Marketplace PMTS",
  });
  assert.equal(typeof pattern, "string");
  const regex = new RegExp(pattern, "i");
  assert.equal(regex.test("AMAZON MARKETPLACE"), true);
});
