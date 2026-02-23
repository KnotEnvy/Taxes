import { readFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_ENTITY_PROFILES, DEFAULT_TENANT, REVIEW_STATUS } from "./domain/constants.mjs";
import { TAXONOMIES } from "./domain/taxonomies.mjs";
import {
  badRequest,
  fileExists,
  getTenantId,
  json,
  methodNotAllowed,
  notFound,
  parseRequestUrl,
  readJsonBody,
  safeStaticPath,
  serverError,
  text,
} from "./http-utils.mjs";
import { buildTaxSummary, taxSummaryToCsv } from "./services/reports/report-service.mjs";
import { listReviewItems } from "./services/review/review-service.mjs";
import {
  createTenantRule,
  createTenantRuleFromTransaction,
  deactivateTenantRule,
  listTenantRules,
} from "./services/classification/rule-service.mjs";
import { scanAndRegisterStatements, registerUploadedStatement } from "./services/statement-ingest-service.mjs";
import {
  applyManualClassification,
  processPendingStatements,
  processStatementById,
  resolveReviewItem,
} from "./services/statement-processor.mjs";
import { nowIso } from "./utils/time.mjs";

const STATIC_CONTENT_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
});

function getContentType(filePath) {
  return STATIC_CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

async function serveStaticFile({ req, res, webRootPath, pathname }) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return false;
  }
  const staticPath = safeStaticPath(webRootPath, pathname);
  if (!staticPath) {
    return false;
  }
  if (!(await fileExists(staticPath))) {
    return false;
  }
  const body = await readFile(staticPath);
  res.writeHead(200, {
    "content-type": getContentType(staticPath),
    "content-length": body.length,
  });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  res.end(body);
  return true;
}

function ensureTenantExists(db, tenantId) {
  return db.tenants.some((tenant) => tenant.id === tenantId);
}

function upsertDefaultBootstrap(db) {
  if (!db.tenants.some((item) => item.id === DEFAULT_TENANT.id)) {
    db.tenants.push({
      ...DEFAULT_TENANT,
      createdAt: nowIso(),
    });
  }

  for (const profile of DEFAULT_ENTITY_PROFILES) {
    if (!db.businessEntityProfiles.some((item) => item.id === profile.id)) {
      db.businessEntityProfiles.push({
        ...profile,
        createdAt: nowIso(),
      });
    }
  }
}

function parseBooleanQuery(value) {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return false;
}

function findTransactionContext(db, transactionId, tenantId) {
  const transaction = db.transactions.find((item) => item.id === transactionId && item.tenantId === tenantId);
  if (!transaction) {
    return null;
  }
  const statement = db.statements.find((item) => item.id === transaction.statementId && item.tenantId === tenantId);
  const account =
    db.financialAccounts.find((item) => item.id === transaction.financialAccountId && item.tenantId === tenantId) ??
    (statement
      ? db.financialAccounts.find(
          (item) => item.id === statement.financialAccountId && item.tenantId === tenantId,
        )
      : null);
  return {
    transaction,
    statement,
    account,
    accountLabel: account?.accountLabel ?? statement?.accountLabel ?? null,
  };
}

function maybeCreateLearnedRule({
  db,
  tenantId,
  body,
  transaction,
  accountLabel,
}) {
  if (!body.createRuleFromTransaction) {
    return null;
  }
  if (!body.categoryCode) {
    throw new Error("categoryCode is required when createRuleFromTransaction=true.");
  }

  if (body.rulePattern) {
    return createTenantRule({
      db,
      tenantId,
      createdBy: body.ruleCreatedBy ?? "dashboard",
      name: body.ruleName,
      scope: body.ruleScope,
      accountLabel: body.ruleScope === "ACCOUNT" ? body.ruleAccountLabel ?? accountLabel : null,
      categoryCode: body.categoryCode,
      pattern: body.rulePattern,
      confidence: body.ruleConfidence,
      priority: body.rulePriority,
    });
  }

  return createTenantRuleFromTransaction({
    db,
    tenantId,
    transaction,
    categoryCode: body.categoryCode,
    scope: body.ruleScope,
    accountLabel: body.ruleScope === "ACCOUNT" ? body.ruleAccountLabel ?? accountLabel : null,
    createdBy: body.ruleCreatedBy ?? "dashboard",
  });
}

export function createRouter({
  store,
  storageRootPath,
  defaultScanPath,
  webRootPath,
}) {
  return async function route(req, res) {
    const url = parseRequestUrl(req);
    const { pathname } = url;

    try {
      if (!pathname.startsWith("/v1") && pathname !== "/health") {
        const served = await serveStaticFile({ req, res, webRootPath, pathname });
        if (served) {
          return;
        }
      }

      if (pathname === "/health") {
        if (req.method !== "GET") {
          methodNotAllowed(res);
          return;
        }
        json(res, 200, {
          status: "ok",
          now: new Date().toISOString(),
        });
        return;
      }

      if (pathname === "/v1/bootstrap") {
        if (req.method !== "POST") {
          methodNotAllowed(res);
          return;
        }
        const db = await store.withWrite(async (current) => {
          upsertDefaultBootstrap(current);
          return current;
        });
        json(res, 200, {
          tenant: db.tenants.find((item) => item.id === DEFAULT_TENANT.id),
          entityProfiles: db.businessEntityProfiles.filter((item) => item.tenantId === DEFAULT_TENANT.id),
        });
        return;
      }

      if (pathname === "/v1/tenants") {
        if (req.method === "GET") {
          const db = await store.read();
          json(res, 200, { tenants: db.tenants });
          return;
        }
        if (req.method === "POST") {
          const body = await readJsonBody(req);
          if (!body.id || !body.name) {
            badRequest(res, "id and name are required.");
            return;
          }
          const db = await store.withWrite(async (current) => {
            if (current.tenants.some((tenant) => tenant.id === body.id)) {
              throw new Error(`Tenant with id=${body.id} already exists.`);
            }
            current.tenants.push({
              id: body.id,
              name: body.name,
              createdAt: nowIso(),
            });
            return current;
          });
          json(res, 201, { tenant: db.tenants.find((tenant) => tenant.id === body.id) });
          return;
        }
        methodNotAllowed(res);
        return;
      }

      if (pathname === "/v1/entity-profiles") {
        if (req.method !== "POST") {
          methodNotAllowed(res);
          return;
        }
        const body = await readJsonBody(req);
        if (!body.tenantId || !body.entityType || !body.effectiveFrom) {
          badRequest(res, "tenantId, entityType, and effectiveFrom are required.");
          return;
        }

        const db = await store.withWrite(async (current) => {
          if (!ensureTenantExists(current, body.tenantId)) {
            throw new Error(`Unknown tenantId=${body.tenantId}`);
          }
          current.businessEntityProfiles.push({
            id: body.id ?? `entity_profile_${Date.now()}`,
            tenantId: body.tenantId,
            entityType: body.entityType,
            effectiveFrom: body.effectiveFrom,
            effectiveTo: body.effectiveTo ?? null,
            createdAt: nowIso(),
          });
          return current;
        });
        const created = db.businessEntityProfiles.at(-1);
        json(res, 201, { profile: created });
        return;
      }

      if (pathname === "/v1/taxonomies") {
        if (req.method !== "GET") {
          methodNotAllowed(res);
          return;
        }
        json(res, 200, { taxonomies: TAXONOMIES });
        return;
      }

      if (pathname === "/v1/rules") {
        if (req.method === "GET") {
          const tenantId = getTenantId(req, url);
          if (!tenantId) {
            badRequest(res, "tenantId is required.");
            return;
          }
          const includeInactive = parseBooleanQuery(url.searchParams.get("includeInactive"));
          const db = await store.read();
          const rules = listTenantRules({ db, tenantId, includeInactive });
          json(res, 200, { rules });
          return;
        }
        if (req.method === "POST") {
          const body = await readJsonBody(req);
          const tenantId = body.tenantId ?? getTenantId(req, url);
          if (!tenantId) {
            badRequest(res, "tenantId is required.");
            return;
          }
          if (!body.categoryCode || !body.pattern) {
            badRequest(res, "categoryCode and pattern are required.");
            return;
          }

          let createdRule = null;
          await store.withWrite(async (current) => {
            createdRule = createTenantRule({
              db: current,
              tenantId,
              createdBy: body.createdBy ?? "api",
              name: body.name,
              scope: body.scope,
              accountLabel: body.accountLabel,
              categoryCode: body.categoryCode,
              pattern: body.pattern,
              confidence: body.confidence,
              priority: body.priority,
            });
            return current;
          });
          json(res, 201, { rule: createdRule });
          return;
        }
        methodNotAllowed(res);
        return;
      }

      const ruleDeleteMatch = pathname.match(/^\/v1\/rules\/([^/]+)$/);
      if (ruleDeleteMatch) {
        if (req.method !== "DELETE") {
          methodNotAllowed(res);
          return;
        }
        const tenantId = getTenantId(req, url);
        if (!tenantId) {
          badRequest(res, "tenantId is required.");
          return;
        }
        const ruleId = ruleDeleteMatch[1];
        let deactivated = null;
        await store.withWrite(async (current) => {
          deactivated = deactivateTenantRule({
            db: current,
            tenantId,
            ruleId,
            updatedBy: "api",
          });
          if (!deactivated) {
            throw new Error(`Rule not found: ${ruleId}`);
          }
          return current;
        });
        json(res, 200, { rule: deactivated });
        return;
      }

      if (pathname === "/v1/statements/scan-local") {
        if (req.method !== "POST") {
          methodNotAllowed(res);
          return;
        }
        const body = await readJsonBody(req);
        const tenantId = body.tenantId ?? getTenantId(req, url);
        if (!tenantId) {
          badRequest(res, "tenantId is required.");
          return;
        }
        const sourceRootPath = body.sourceRootPath ?? defaultScanPath;
        const db = await store.read();
        if (!ensureTenantExists(db, tenantId)) {
          badRequest(res, `Unknown tenantId=${tenantId}`);
          return;
        }
        const result = await scanAndRegisterStatements({
          store,
          tenantId,
          sourceRootPath,
          storageRootPath,
          uploadedBy: body.uploadedBy ?? "scan-local",
        });
        json(res, 200, result);
        return;
      }

      if (pathname === "/v1/statements/upload") {
        if (req.method !== "POST") {
          methodNotAllowed(res);
          return;
        }
        const body = await readJsonBody(req);
        const tenantId = body.tenantId ?? getTenantId(req, url);
        if (!tenantId || !body.contentBase64) {
          badRequest(res, "tenantId and contentBase64 are required.");
          return;
        }
        const statement = await registerUploadedStatement({
          store,
          tenantId,
          fileName: body.fileName ?? "statement.pdf",
          contentBase64: body.contentBase64,
          storageRootPath,
          uploadedBy: body.uploadedBy ?? "upload-api",
          institutionHint: body.institution,
          accountLabelHint: body.accountLabel,
        });
        json(res, 201, { statement });
        return;
      }

      if (pathname === "/v1/statements") {
        if (req.method !== "GET") {
          methodNotAllowed(res);
          return;
        }
        const tenantId = getTenantId(req, url);
        if (!tenantId) {
          badRequest(res, "tenantId is required.");
          return;
        }
        const status = url.searchParams.get("status");
        const db = await store.read();
        const statements = db.statements
          .filter((item) => item.tenantId === tenantId)
          .filter((item) => (status ? item.status === status : true))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        json(res, 200, { statements });
        return;
      }

      if (pathname === "/v1/statements/process-pending") {
        if (req.method !== "POST") {
          methodNotAllowed(res);
          return;
        }
        const body = await readJsonBody(req);
        const limit = Number.parseInt(body.limit ?? "10", 10);
        const result = await processPendingStatements({ store, limit });
        json(res, 200, result);
        return;
      }

      const processMatch = pathname.match(/^\/v1\/statements\/([^/]+)\/process$/);
      if (processMatch) {
        if (req.method !== "POST") {
          methodNotAllowed(res);
          return;
        }
        const statementId = processMatch[1];
        const result = await processStatementById({ store, statementId });
        json(res, 200, result);
        return;
      }

      const txListMatch = pathname.match(/^\/v1\/statements\/([^/]+)\/transactions$/);
      if (txListMatch) {
        if (req.method !== "GET") {
          methodNotAllowed(res);
          return;
        }
        const statementId = txListMatch[1];
        const tenantId = getTenantId(req, url);
        if (!tenantId) {
          badRequest(res, "tenantId is required.");
          return;
        }
        const db = await store.read();
        const transactions = db.transactions
          .filter((item) => item.tenantId === tenantId && item.statementId === statementId)
          .sort((a, b) => a.postedDate.localeCompare(b.postedDate));
        json(res, 200, { transactions });
        return;
      }

      if (pathname === "/v1/review-queue") {
        if (req.method !== "GET") {
          methodNotAllowed(res);
          return;
        }
        const tenantId = getTenantId(req, url);
        if (!tenantId) {
          badRequest(res, "tenantId is required.");
          return;
        }
        const status = url.searchParams.get("status");
        const db = await store.read();
        const items = listReviewItems({ db, tenantId, status });
        json(res, 200, { reviewItems: items });
        return;
      }

      const resolveReviewMatch = pathname.match(/^\/v1\/review-queue\/([^/]+)\/resolve$/);
      if (resolveReviewMatch) {
        if (req.method !== "POST") {
          methodNotAllowed(res);
          return;
        }
        const reviewId = resolveReviewMatch[1];
        const body = await readJsonBody(req);
        const tenantId = body.tenantId ?? getTenantId(req, url);
        if (!tenantId) {
          badRequest(res, "tenantId is required.");
          return;
        }
        let learnedRule = null;
        const db = await store.withWrite(async (current) => {
          const review = resolveReviewItem({
            db: current,
            tenantId,
            reviewId,
            note: body.note,
          });
          if (!review) {
            throw new Error(`Review item not found: ${reviewId}`);
          }
          if (review.transactionId && body.categoryCode) {
            const classified = applyManualClassification({
              db: current,
              tenantId,
              transactionId: review.transactionId,
              categoryCode: body.categoryCode,
              note: body.note ?? "Resolved with manual classification",
            });
            if (classified) {
              const context = findTransactionContext(current, classified.id, tenantId);
              learnedRule = maybeCreateLearnedRule({
                db: current,
                tenantId,
                body,
                transaction: classified,
                accountLabel: context?.accountLabel ?? null,
              });
            }
          }
          return current;
        });
        const reviewItem = db.reviewQueue.find((item) => item.id === reviewId);
        json(res, 200, { reviewItem, learnedRule });
        return;
      }

      const classifyMatch = pathname.match(/^\/v1\/transactions\/([^/]+)\/classify$/);
      if (classifyMatch) {
        if (req.method !== "POST") {
          methodNotAllowed(res);
          return;
        }
        const transactionId = classifyMatch[1];
        const body = await readJsonBody(req);
        const tenantId = body.tenantId ?? getTenantId(req, url);
        if (!tenantId || !body.categoryCode) {
          badRequest(res, "tenantId and categoryCode are required.");
          return;
        }
        let learnedRule = null;
        const db = await store.withWrite(async (current) => {
          const tx = applyManualClassification({
            db: current,
            tenantId,
            transactionId,
            categoryCode: body.categoryCode,
            note: body.note,
          });
          if (!tx) {
            throw new Error(`Transaction not found: ${transactionId}`);
          }
          const context = findTransactionContext(current, transactionId, tenantId);
          learnedRule = maybeCreateLearnedRule({
            db: current,
            tenantId,
            body,
            transaction: tx,
            accountLabel: context?.accountLabel ?? null,
          });
          return current;
        });
        const transaction = db.transactions.find((item) => item.id === transactionId);
        json(res, 200, { transaction, learnedRule });
        return;
      }

      if (pathname === "/v1/reports/tax-summary") {
        if (req.method !== "GET") {
          methodNotAllowed(res);
          return;
        }
        const tenantId = getTenantId(req, url);
        const year = Number.parseInt(url.searchParams.get("year") ?? "", 10);
        if (!tenantId || !Number.isInteger(year)) {
          badRequest(res, "tenantId and year are required.");
          return;
        }
        const db = await store.read();
        const summary = buildTaxSummary({ tenantId, year, db });
        json(res, 200, summary);
        return;
      }

      if (pathname === "/v1/reports/export") {
        if (req.method !== "GET") {
          methodNotAllowed(res);
          return;
        }
        const tenantId = getTenantId(req, url);
        const year = Number.parseInt(url.searchParams.get("year") ?? "", 10);
        const format = (url.searchParams.get("format") ?? "csv").toLowerCase();
        if (!tenantId || !Number.isInteger(year)) {
          badRequest(res, "tenantId and year are required.");
          return;
        }
        const db = await store.read();
        const summary = buildTaxSummary({ tenantId, year, db });
        if (format === "json") {
          json(res, 200, summary);
          return;
        }
        const csv = taxSummaryToCsv(summary);
        text(res, 200, csv, "text/csv; charset=utf-8");
        return;
      }

      if (pathname === "/v1/stats") {
        if (req.method !== "GET") {
          methodNotAllowed(res);
          return;
        }
        const tenantId = getTenantId(req, url);
        if (!tenantId) {
          badRequest(res, "tenantId is required.");
          return;
        }
        const db = await store.read();
        const statementCount = db.statements.filter((item) => item.tenantId === tenantId).length;
        const transactionCount = db.transactions.filter((item) => item.tenantId === tenantId).length;
        const openReviewCount = db.reviewQueue.filter(
          (item) => item.tenantId === tenantId && item.status === REVIEW_STATUS.OPEN,
        ).length;
        json(res, 200, {
          tenantId,
          statementCount,
          transactionCount,
          openReviewCount,
        });
        return;
      }

      notFound(res);
    } catch (error) {
      serverError(res, error);
    }
  };
}
