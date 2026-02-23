const SUPPORTED_INSTITUTIONS = Object.freeze([
  "AMEX",
  "BLUEVINE",
  "CAPITAL_ONE",
  "CASH_APP",
  "DISCOVER",
  "SPACE_COAST",
]);

function normalizeInstitution(value) {
  return `${value ?? "UNKNOWN"}`.trim().toUpperCase();
}

function createAdapter({ institution, method, noiseWords = [] }) {
  return Object.freeze({
    institution: normalizeInstitution(institution),
    method,
    fallbackToGeneric: false,
    noiseWords: Object.freeze(
      noiseWords
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  });
}

export const GENERIC_PARSER_ADAPTER = Object.freeze({
  institution: "UNKNOWN",
  method: "GENERIC_V1",
  fallbackToGeneric: true,
  noiseWords: Object.freeze([]),
});

const ADAPTERS_BY_INSTITUTION = Object.freeze({
  AMEX: createAdapter({
    institution: "AMEX",
    method: "AMEX_V1",
    noiseWords: [
      "american express",
      "payments and credits",
      "new charges",
      "total fees",
      "late payment warning",
    ],
  }),
  BLUEVINE: createAdapter({
    institution: "BLUEVINE",
    method: "BLUEVINE_V1",
    noiseWords: [
      "deposits and other credits",
      "debits and other withdrawals",
      "daily ledger balance",
      "average balance",
      "running balance",
    ],
  }),
  CAPITAL_ONE: createAdapter({
    institution: "CAPITAL_ONE",
    method: "CAPITAL_ONE_V1",
    noiseWords: [
      "payment information",
      "transactions by merchant category",
      "interest charge calculation",
      "account summary",
      "rewards summary",
    ],
  }),
  CASH_APP: createAdapter({
    institution: "CASH_APP",
    method: "CASH_APP_V1",
    noiseWords: [
      "cash app summary",
      "monthly statement",
      "direct deposit totals",
      "account activity summary",
      "ending cash balance",
    ],
  }),
  DISCOVER: createAdapter({
    institution: "DISCOVER",
    method: "DISCOVER_V1",
    noiseWords: [
      "discover account summary",
      "credit line",
      "minimum payment",
      "cash advance line",
      "revolving account summary",
    ],
  }),
  SPACE_COAST: createAdapter({
    institution: "SPACE_COAST",
    method: "SPACE_COAST_V1",
    noiseWords: [
      "shares and deposits",
      "withdrawals and debits",
      "dividends paid",
      "year-to-date dividends",
      "beginning balance",
      "ending balance",
    ],
  }),
});

export function resolveParserAdapter(institution) {
  const key = normalizeInstitution(institution);
  return ADAPTERS_BY_INSTITUTION[key] ?? GENERIC_PARSER_ADAPTER;
}

export function hasInstitutionAdapter(institution) {
  const key = normalizeInstitution(institution);
  return Boolean(ADAPTERS_BY_INSTITUTION[key]);
}

export function listSupportedInstitutions() {
  return [...SUPPORTED_INSTITUTIONS];
}
