import {
  CLASSIFICATION_METHOD,
  CONFIDENCE_THRESHOLD,
  REVIEW_REASON,
  REVIEW_STATUS,
  STATEMENT_STATUS,
} from "../domain/constants.mjs";
import { getTaxonomyForEntityYear } from "../domain/taxonomies.mjs";
import { newId } from "../utils/id.mjs";
import { isDateWithinRange, nowIso } from "../utils/time.mjs";
import { ClassificationService } from "./classification/classification-service.mjs";
import { listTenantRules } from "./classification/rule-service.mjs";
import { parseStatementPdf } from "./parser/statement-parser.mjs";

function resolveEntityProfile({ tenantId, statementYear, profiles }) {
  const anchorDate = `${statementYear}-12-31`;
  return (
    profiles.find(
      (profile) =>
        profile.tenantId === tenantId &&
        isDateWithinRange(anchorDate, profile.effectiveFrom, profile.effectiveTo ?? null),
    ) ?? null
  );
}

function createReviewItem({
  db,
  tenantId,
  statementId,
  transactionId,
  reason,
  detail,
}) {
  db.reviewQueue.push({
    id: newId("review"),
    tenantId,
    statementId,
    transactionId: transactionId ?? null,
    reason,
    detail: detail ?? null,
    status: REVIEW_STATUS.OPEN,
    createdAt: nowIso(),
    resolvedAt: null,
    resolutionNote: null,
  });
}

function addAuditEvent(db, tenantId, action, payload) {
  db.auditEvents.push({
    id: newId("audit"),
    tenantId,
    action,
    payload,
    createdAt: nowIso(),
  });
}

export async function processStatementById({
  store,
  statementId,
  classificationService = new ClassificationService(),
}) {
  let result = null;

  await store.withWrite(async (db) => {
    const statement = db.statements.find((item) => item.id === statementId);
    if (!statement) {
      throw new Error(`Statement not found: ${statementId}`);
    }

    const profiles = db.businessEntityProfiles;
    const profile = resolveEntityProfile({
      tenantId: statement.tenantId,
      statementYear: statement.statementYear ?? new Date().getUTCFullYear(),
      profiles,
    });
    const entityType = profile?.entityType ?? "SOLE_PROP";
    const taxonomy = getTaxonomyForEntityYear(entityType, statement.statementYear ?? new Date().getUTCFullYear());

    if (!taxonomy) {
      statement.status = STATEMENT_STATUS.ERROR;
      statement.error = "No taxonomy found for entity profile.";
      result = { statementId, status: statement.status, error: statement.error };
      return db;
    }

    const parsed = await parseStatementPdf({
      filePath: statement.storedPath,
      statementYear: statement.statementYear ?? taxonomy.taxYear,
    });
    statement.parseDiagnostics = parsed.diagnostics;

    if (statement.folderYearMismatch) {
      createReviewItem({
        db,
        tenantId: statement.tenantId,
        statementId: statement.id,
        reason: REVIEW_REASON.YEAR_MISMATCH,
        detail: "Statement year does not match source folder year.",
      });
    }

    const existingTxIds = new Set(
      db.transactions.filter((tx) => tx.tenantId === statement.tenantId && tx.statementId === statement.id).map((tx) => tx.id),
    );
    if (existingTxIds.size > 0) {
      db.transactions = db.transactions.filter((tx) => !(tx.tenantId === statement.tenantId && tx.statementId === statement.id));
      db.reviewQueue = db.reviewQueue.filter((item) => !(item.tenantId === statement.tenantId && item.statementId === statement.id));
    }

    const tenantRules = listTenantRules({ db, tenantId: statement.tenantId, includeInactive: false });
    const transactionRows = [];
    for (const transaction of parsed.transactions) {
      const txId = newId("tx");
      const decision = await classificationService.classify({
        transaction,
        context: {
          tenantId: statement.tenantId,
          taxonomyId: taxonomy.id,
          accountLabel: statement.accountLabel,
          customRules: tenantRules,
        },
      });
      const row = {
        id: txId,
        tenantId: statement.tenantId,
        statementId: statement.id,
        financialAccountId: statement.financialAccountId,
        postedDate: transaction.postedDate,
        amount: transaction.amount,
        description: transaction.description,
        rawLine: transaction.rawLine,
        taxonomyId: taxonomy.id,
        categoryCode: decision.categoryCode,
        confidence: decision.confidence,
        classificationMethod: decision.method,
        reasonCodes: decision.reasonCodes,
        needsReview: decision.needsReview,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      transactionRows.push(row);
      if (row.needsReview || row.confidence < CONFIDENCE_THRESHOLD) {
        createReviewItem({
          db,
          tenantId: statement.tenantId,
          statementId: statement.id,
          transactionId: txId,
          reason: REVIEW_REASON.LOW_CONFIDENCE,
          detail: `confidence=${row.confidence.toFixed(2)} method=${row.classificationMethod}`,
        });
      }
    }

    db.transactions.push(...transactionRows);

    statement.status =
      statement.folderYearMismatch || db.reviewQueue.some((item) => item.statementId === statement.id && item.status === REVIEW_STATUS.OPEN)
        ? STATEMENT_STATUS.NEEDS_REVIEW
        : STATEMENT_STATUS.PROCESSED;
    statement.processedAt = nowIso();
    statement.error = null;

    addAuditEvent(db, statement.tenantId, "statement.processed", {
      statementId: statement.id,
      taxonomyId: taxonomy.id,
      transactionCount: transactionRows.length,
      status: statement.status,
    });

    result = {
      statementId: statement.id,
      status: statement.status,
      taxonomyId: taxonomy.id,
      transactionCount: transactionRows.length,
      reviewCount: db.reviewQueue.filter((item) => item.statementId === statement.id && item.status === REVIEW_STATUS.OPEN).length,
    };

    return db;
  });

  return result;
}

export async function processPendingStatements({
  store,
  limit = 10,
  classificationService = new ClassificationService(),
}) {
  const db = await store.read();
  const pending = db.statements
    .filter((statement) => statement.status === STATEMENT_STATUS.QUEUED || statement.status === STATEMENT_STATUS.NEEDS_REVIEW)
    .slice(0, limit);

  const processed = [];
  for (const statement of pending) {
    const result = await processStatementById({
      store,
      statementId: statement.id,
      classificationService,
    });
    processed.push(result);
  }
  return {
    requestedLimit: limit,
    processedCount: processed.length,
    processed,
  };
}

export function applyManualClassification({ db, tenantId, transactionId, categoryCode, note }) {
  const tx = db.transactions.find((item) => item.tenantId === tenantId && item.id === transactionId);
  if (!tx) {
    return null;
  }
  tx.categoryCode = categoryCode;
  tx.classificationMethod = CLASSIFICATION_METHOD.MANUAL;
  tx.confidence = 1;
  tx.needsReview = false;
  tx.reasonCodes = ["manual_override"];
  tx.updatedAt = nowIso();

  for (const review of db.reviewQueue) {
    if (review.tenantId === tenantId && review.transactionId === transactionId && review.status === REVIEW_STATUS.OPEN) {
      review.status = REVIEW_STATUS.RESOLVED;
      review.resolvedAt = nowIso();
      review.resolutionNote = note ?? `Manual classification: ${categoryCode}`;
    }
  }

  addAuditEvent(db, tenantId, "transaction.manual_classification", {
    transactionId,
    categoryCode,
    note: note ?? null,
  });

  return tx;
}

export function resolveReviewItem({ db, tenantId, reviewId, note }) {
  const review = db.reviewQueue.find((item) => item.tenantId === tenantId && item.id === reviewId);
  if (!review) {
    return null;
  }
  review.status = REVIEW_STATUS.RESOLVED;
  review.resolvedAt = nowIso();
  review.resolutionNote = note ?? "Resolved by reviewer";
  addAuditEvent(db, tenantId, "review.resolved", { reviewId, note: review.resolutionNote });
  return review;
}
