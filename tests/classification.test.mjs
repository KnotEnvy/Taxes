import test from "node:test";
import assert from "node:assert/strict";
import { TAXONOMY_IDS } from "../apps/api/src/domain/constants.mjs";
import { ClassificationService } from "../apps/api/src/services/classification/classification-service.mjs";

test("classifies payroll account with high confidence via rules", async () => {
  const service = new ClassificationService();
  const decision = await service.classify({
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
});

test("falls back to other_expense and review when unknown", async () => {
  const service = new ClassificationService();
  const decision = await service.classify({
    transaction: {
      description: "MYSTERY VENDOR ZXQ",
      rawLine: "05/10 MYSTERY VENDOR ZXQ 99.14",
    },
    context: {
      taxonomyId: TAXONOMY_IDS.SCHEDULE_C_2024,
      accountLabel: "checking 3190",
    },
  });

  assert.equal(typeof decision.categoryCode, "string");
  assert.equal(decision.needsReview, true);
});
