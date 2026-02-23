import { newId } from "../../utils/id.mjs";
import { nowIso } from "../../utils/time.mjs";

const RULE_SCOPE = Object.freeze({
  TENANT: "TENANT",
  ACCOUNT: "ACCOUNT",
});

const SAFE_PATTERN_CHARS = /[^a-z0-9\s]/gi;

function coerceNumber(value, fallback) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function coerceBoolean(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function normalizeScope(scopeInput) {
  const value = (scopeInput ?? RULE_SCOPE.TENANT).toString().toUpperCase();
  return value === RULE_SCOPE.ACCOUNT ? RULE_SCOPE.ACCOUNT : RULE_SCOPE.TENANT;
}

export function normalizeRuleRecord(record) {
  const payload = record?.payload && typeof record.payload === "object" ? record.payload : record;
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const out = {
    id: payload.id ?? record.id ?? null,
    tenantId: payload.tenantId ?? record.tenantId ?? null,
    name: payload.name ?? null,
    scope: normalizeScope(payload.scope),
    accountLabel: payload.accountLabel ?? null,
    categoryCode: payload.categoryCode ?? null,
    pattern: payload.pattern ?? null,
    confidence: coerceNumber(payload.confidence, 0.9),
    priority: Math.trunc(coerceNumber(payload.priority, 100)),
    active: coerceBoolean(payload.active, true),
    createdBy: payload.createdBy ?? null,
    createdAt: payload.createdAt ?? record.createdAt ?? null,
    updatedAt: payload.updatedAt ?? null,
  };

  if (!out.id || !out.tenantId || !out.categoryCode || !out.pattern) {
    return null;
  }
  return out;
}

export function listTenantRules({ db, tenantId, includeInactive = false }) {
  return db.rules
    .map((rule) => normalizeRuleRecord(rule))
    .filter((rule) => rule && rule.tenantId === tenantId)
    .filter((rule) => (includeInactive ? true : rule.active))
    .sort((a, b) => b.priority - a.priority || (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
}

function ensurePatternCompiles(pattern) {
  try {
    // eslint-disable-next-line no-new
    new RegExp(pattern, "i");
  } catch {
    throw new Error(`Invalid regex pattern: ${pattern}`);
  }
}

export function createTenantRule({
  db,
  tenantId,
  createdBy,
  name,
  scope,
  accountLabel,
  categoryCode,
  pattern,
  confidence,
  priority,
}) {
  if (!tenantId || !categoryCode || !pattern) {
    throw new Error("tenantId, categoryCode, and pattern are required.");
  }
  ensurePatternCompiles(pattern);
  const normalizedScope = normalizeScope(scope);
  if (normalizedScope === RULE_SCOPE.ACCOUNT && !accountLabel) {
    throw new Error("accountLabel is required for ACCOUNT scoped rules.");
  }

  const rule = {
    id: newId("rule"),
    tenantId,
    name: name ?? `${categoryCode} rule`,
    scope: normalizedScope,
    accountLabel: normalizedScope === RULE_SCOPE.ACCOUNT ? accountLabel : null,
    categoryCode,
    pattern,
    confidence: coerceNumber(confidence, 0.93),
    priority: Math.trunc(coerceNumber(priority, normalizedScope === RULE_SCOPE.ACCOUNT ? 1000 : 500)),
    active: true,
    createdBy: createdBy ?? "system",
    createdAt: nowIso(),
    updatedAt: null,
  };
  db.rules.push(rule);
  return rule;
}

export function deactivateTenantRule({ db, tenantId, ruleId, updatedBy }) {
  const target = db.rules
    .map((rule, index) => ({ index, normalized: normalizeRuleRecord(rule) }))
    .find((item) => item.normalized && item.normalized.tenantId === tenantId && item.normalized.id === ruleId);
  if (!target) {
    return null;
  }

  const rule = target.normalized;
  const updated = {
    ...rule,
    active: false,
    updatedAt: nowIso(),
    createdBy: rule.createdBy ?? updatedBy ?? "system",
  };
  db.rules[target.index] = updated;
  return updated;
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildPatternFromTransaction(transaction) {
  const source = `${transaction?.description ?? ""}`.trim().toLowerCase();
  const cleaned = source.replace(SAFE_PATTERN_CHARS, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return null;
  }

  const words = cleaned
    .split(" ")
    .filter((word) => word.length >= 3)
    .filter((word) => !/^\d+$/.test(word))
    .slice(0, 4);
  if (words.length === 0) {
    return null;
  }

  // Match words in order while allowing separators often present in statement strings.
  return `\\b${words.map((word) => escapeRegex(word)).join("\\s*")}\\b`;
}

export function createTenantRuleFromTransaction({
  db,
  tenantId,
  transaction,
  categoryCode,
  scope,
  accountLabel,
  createdBy,
}) {
  const pattern = buildPatternFromTransaction(transaction);
  if (!pattern) {
    throw new Error("Could not derive a rule pattern from transaction description.");
  }

  return createTenantRule({
    db,
    tenantId,
    createdBy,
    name: `Learned from ${transaction.description.slice(0, 40)}`,
    scope,
    accountLabel,
    categoryCode,
    pattern,
    confidence: 0.95,
    priority: scope === RULE_SCOPE.ACCOUNT ? 1100 : 600,
  });
}

export const RULE_SCOPES = RULE_SCOPE;
