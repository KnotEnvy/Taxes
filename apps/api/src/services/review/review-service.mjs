import { REVIEW_STATUS } from "../../domain/constants.mjs";

export function listReviewItems({ db, tenantId, status }) {
  return db.reviewQueue
    .filter((item) => item.tenantId === tenantId)
    .filter((item) => (status ? item.status === status : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getOpenReviewCountForStatement({ db, statementId }) {
  return db.reviewQueue.filter((item) => item.statementId === statementId && item.status === REVIEW_STATUS.OPEN).length;
}
