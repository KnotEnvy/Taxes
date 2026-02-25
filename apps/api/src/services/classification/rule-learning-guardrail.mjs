import { REVIEW_REASON, REVIEW_STATUS } from "../../domain/constants.mjs";

function isParseWarningOpenForStatement({ db, tenantId, statementId }) {
  return db.reviewQueue.some(
    (item) =>
      item.tenantId === tenantId &&
      item.statementId === statementId &&
      item.reason === REVIEW_REASON.PARSE_WARNING &&
      item.status === REVIEW_STATUS.OPEN,
  );
}

export function ensureLearnedRuleAllowed({
  db,
  tenantId,
  transaction,
  allowParseWarningOverride = false,
}) {
  if (allowParseWarningOverride) {
    return;
  }

  const statementId = transaction?.statementId ?? null;
  if (!statementId) {
    return;
  }

  if (isParseWarningOpenForStatement({ db, tenantId, statementId })) {
    throw new Error(
      "Cannot create learned rule while statement has an open PARSE_WARNING. Resolve the parse warning first or explicitly approve this override.",
    );
  }
}
