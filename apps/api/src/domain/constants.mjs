export const ENTITY_TYPES = Object.freeze({
  SOLE_PROP: "SOLE_PROP",
  C_CORP: "C_CORP",
});

export const TAXONOMY_IDS = Object.freeze({
  SCHEDULE_C_2024: "SCHEDULE_C_2024",
  FORM_1120_2025: "FORM_1120_2025",
});

export const STATEMENT_STATUS = Object.freeze({
  QUEUED: "QUEUED",
  PROCESSED: "PROCESSED",
  NEEDS_REVIEW: "NEEDS_REVIEW",
  ERROR: "ERROR",
});

export const REVIEW_STATUS = Object.freeze({
  OPEN: "OPEN",
  RESOLVED: "RESOLVED",
});

export const REVIEW_REASON = Object.freeze({
  LOW_CONFIDENCE: "LOW_CONFIDENCE",
  YEAR_MISMATCH: "YEAR_MISMATCH",
  PARSE_WARNING: "PARSE_WARNING",
});

export const CLASSIFICATION_METHOD = Object.freeze({
  RULE: "RULE",
  AI: "AI",
  MANUAL: "MANUAL",
  FALLBACK: "FALLBACK",
});

export const CONFIDENCE_THRESHOLD = 0.85;

export const DEFAULT_TENANT = Object.freeze({
  id: "tenant_local_cleaning",
  name: "Local Cleaning Business",
});

export const DEFAULT_ENTITY_PROFILES = Object.freeze([
  {
    id: "entity_profile_2024",
    tenantId: DEFAULT_TENANT.id,
    entityType: ENTITY_TYPES.SOLE_PROP,
    effectiveFrom: "2024-01-01",
    effectiveTo: "2024-12-31",
  },
  {
    id: "entity_profile_2025",
    tenantId: DEFAULT_TENANT.id,
    entityType: ENTITY_TYPES.C_CORP,
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
  },
]);
