import test from "node:test";
import assert from "node:assert/strict";
import {
  CLASSIFICATION_METHOD,
  REVIEW_REASON,
  STATEMENT_STATUS,
} from "../apps/api/src/domain/constants.mjs";
import { processStatementById } from "../apps/api/src/services/statement-processor.mjs";

function createInMemoryStore(seedDb) {
  let db = structuredClone(seedDb);
  return {
    async read() {
      return structuredClone(db);
    },
    async withWrite(mutator) {
      const working = structuredClone(db);
      const maybeNext = await mutator(working);
      db = maybeNext ?? working;
      return structuredClone(db);
    },
  };
}

function buildSeedDb() {
  const tenantId = "tenant_test";
  return {
    tenants: [
      {
        id: tenantId,
        name: "Test Tenant",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    businessEntityProfiles: [
      {
        id: "entity_2024",
        tenantId,
        entityType: "SOLE_PROP",
        effectiveFrom: "2024-01-01",
        effectiveTo: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    financialAccounts: [
      {
        id: "acct_test",
        tenantId,
        institution: "AMEX",
        accountLabel: "checking 3190",
        last4: "3190",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    statements: [
      {
        id: "stmt_test",
        tenantId,
        financialAccountId: "acct_test",
        institution: "AMEX",
        accountLabel: "checking 3190",
        fileName: "2024-01-31.pdf",
        storedPath: "D:/Taxes/storage/statements/tenant_test/stub.pdf",
        sourcePath: "test",
        checksum: "abc123",
        statementYear: 2024,
        statementMonth: 1,
        statementDay: 31,
        folderYearMismatch: false,
        status: STATEMENT_STATUS.QUEUED,
        parseDiagnostics: null,
        error: null,
        uploadedBy: "test",
        createdAt: "2026-01-01T00:00:00.000Z",
        processedAt: null,
      },
    ],
    transactions: [],
    reviewQueue: [],
    auditEvents: [],
    rules: [],
  };
}

function createHighConfidenceClassifier() {
  return {
    async classify() {
      return {
        categoryCode: "supplies",
        confidence: 0.99,
        method: CLASSIFICATION_METHOD.RULE,
        reasonCodes: ["test_rule"],
        needsReview: false,
      };
    },
  };
}

test("adds PARSE_WARNING review when parser confidence is below threshold", async () => {
  const store = createInMemoryStore(buildSeedDb());
  const parseStatement = async () => ({
    transactions: [
      {
        postedDate: "2024-01-10",
        amount: 42.55,
        description: "OFFICE DEPOT",
        rawLine: "01/10 OFFICE DEPOT 42.55",
      },
    ],
    diagnostics: {
      parseMethod: "AMEX_V1",
      institutionAdapter: "AMEX",
      fallbackToGeneric: false,
      textLines: 220,
      droppedNoiseLines: 80,
      candidateLines: 10,
      rawParsedTransactions: 1,
      parsedTransactions: 1,
      parserConfidence: 0.1,
    },
  });

  const result = await processStatementById({
    store,
    statementId: "stmt_test",
    classificationService: createHighConfidenceClassifier(),
    parseStatement,
  });

  assert.equal(result.status, STATEMENT_STATUS.NEEDS_REVIEW);
  const db = await store.read();
  assert.equal(db.transactions.length, 1);
  const parseWarning = db.reviewQueue.find((item) => item.reason === REVIEW_REASON.PARSE_WARNING);
  assert.ok(parseWarning);
  assert.match(parseWarning.detail, /method=AMEX_V1/);
  assert.match(parseWarning.detail, /confidence=0\.100/);
});

test("does not add PARSE_WARNING review when parser confidence is healthy", async () => {
  const store = createInMemoryStore(buildSeedDb());
  const parseStatement = async () => ({
    transactions: [
      {
        postedDate: "2024-01-10",
        amount: 42.55,
        description: "OFFICE DEPOT",
        rawLine: "01/10 OFFICE DEPOT 42.55",
      },
    ],
    diagnostics: {
      parseMethod: "AMEX_V1",
      institutionAdapter: "AMEX",
      fallbackToGeneric: false,
      textLines: 220,
      droppedNoiseLines: 80,
      candidateLines: 2,
      rawParsedTransactions: 1,
      parsedTransactions: 1,
      parserConfidence: 0.5,
    },
  });

  const result = await processStatementById({
    store,
    statementId: "stmt_test",
    classificationService: createHighConfidenceClassifier(),
    parseStatement,
  });

  assert.equal(result.status, STATEMENT_STATUS.PROCESSED);
  const db = await store.read();
  assert.equal(db.reviewQueue.filter((item) => item.reason === REVIEW_REASON.PARSE_WARNING).length, 0);
  assert.equal(db.statements[0].parseDiagnostics.parseMethod, "AMEX_V1");
});
