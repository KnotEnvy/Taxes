import test from "node:test";
import assert from "node:assert/strict";
import { REVIEW_REASON, REVIEW_STATUS } from "../apps/api/src/domain/constants.mjs";
import { ensureLearnedRuleAllowed } from "../apps/api/src/services/classification/rule-learning-guardrail.mjs";

function buildDbWithParseWarning(status = REVIEW_STATUS.OPEN) {
  return {
    reviewQueue: [
      {
        id: "review_1",
        tenantId: "tenant_1",
        statementId: "stmt_1",
        transactionId: null,
        reason: REVIEW_REASON.PARSE_WARNING,
        status,
      },
    ],
  };
}

test("blocks learned rule creation when statement has open PARSE_WARNING", () => {
  assert.throws(
    () =>
      ensureLearnedRuleAllowed({
        db: buildDbWithParseWarning(REVIEW_STATUS.OPEN),
        tenantId: "tenant_1",
        transaction: { id: "tx_1", statementId: "stmt_1" },
      }),
    /open PARSE_WARNING/i,
  );
});

test("allows learned rule creation when PARSE_WARNING override is approved", () => {
  assert.doesNotThrow(() =>
    ensureLearnedRuleAllowed({
      db: buildDbWithParseWarning(REVIEW_STATUS.OPEN),
      tenantId: "tenant_1",
      transaction: { id: "tx_1", statementId: "stmt_1" },
      allowParseWarningOverride: true,
    }),
  );
});

test("allows learned rule creation when PARSE_WARNING is resolved", () => {
  assert.doesNotThrow(() =>
    ensureLearnedRuleAllowed({
      db: buildDbWithParseWarning(REVIEW_STATUS.RESOLVED),
      tenantId: "tenant_1",
      transaction: { id: "tx_1", statementId: "stmt_1" },
    }),
  );
});
