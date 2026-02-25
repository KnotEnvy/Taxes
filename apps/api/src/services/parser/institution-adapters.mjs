const SUPPORTED_INSTITUTIONS = Object.freeze([
  "AMEX",
  "BLUEVINE",
  "CAPITAL_ONE",
  "CASH_APP",
  "DISCOVER",
  "SPACE_COAST",
]);

const DUAL_DATE_AMOUNT_PATTERN =
  /^(?<date1>\d{1,2}\/\d{1,2})(?:\s+(?<date2>\d{1,2}\/\d{1,2}))?\s+(?<description>.+?)\s+(?<amount>\(?-?\$?\d{1,3}(?:,\d{3})*\.\d{2}\)?)(?:\s*(?<indicator>CR|DB))?$/i;

function normalizeInstitution(value) {
  return `${value ?? "UNKNOWN"}`.trim().toUpperCase();
}

function normalizeDescription(value) {
  return `${value ?? ""}`.replace(/\s+/g, " ").trim();
}

function parseAmountWithIndicator(amountToken, indicator, helpers) {
  if (typeof helpers?.parseAmount !== "function") {
    return null;
  }

  let amount = amountToken;
  const direction = `${indicator ?? ""}`.trim().toUpperCase();
  if (direction === "CR" && !amount.startsWith("-") && !(amount.startsWith("(") && amount.endsWith(")"))) {
    amount = `-${amount}`;
  }
  if (direction === "DB" && amount.startsWith("-")) {
    amount = amount.slice(1);
  }
  return helpers.parseAmount(amount);
}

function parseDualDateAmountLine({ normalized, statementYear, helpers }) {
  const match = normalized.match(DUAL_DATE_AMOUNT_PATTERN);
  if (!match?.groups) {
    return null;
  }
  if (typeof helpers?.parseDateToken !== "function") {
    return null;
  }

  const postedToken = match.groups.date2 || match.groups.date1;
  const posted = helpers.parseDateToken(postedToken, statementYear);
  if (!posted?.value) {
    return null;
  }

  const description = normalizeDescription(match.groups.description);
  if (description.length < 3) {
    return null;
  }

  const amount = parseAmountWithIndicator(match.groups.amount, match.groups.indicator, helpers);
  if (amount === null) {
    return null;
  }

  return {
    postedDate: posted.value,
    amount,
    description,
    rawLine: normalized,
  };
}

function parseAmexLine({ normalized, statementYear, helpers }) {
  const parsed = parseDualDateAmountLine({ normalized, statementYear, helpers });
  if (!parsed) {
    return null;
  }
  if (/\b(total|subtotal|balance)\b/i.test(parsed.description)) {
    return null;
  }
  return parsed;
}

function parseDiscoverLine({ normalized, statementYear, helpers }) {
  const parsed = parseDualDateAmountLine({ normalized, statementYear, helpers });
  if (!parsed) {
    return null;
  }
  if (/\b(account summary|payment due|minimum payment)\b/i.test(parsed.description)) {
    return null;
  }
  return parsed;
}

function parseBluevineLine({ normalized, statementYear, helpers }) {
  const parsed = parseDualDateAmountLine({ normalized, statementYear, helpers });
  if (!parsed) {
    return null;
  }
  if (/\b(daily ledger balance|beginning balance|ending balance)\b/i.test(parsed.description)) {
    return null;
  }
  return parsed;
}

function parseCapitalOneLine({ normalized, statementYear, helpers }) {
  const parsed = parseDualDateAmountLine({ normalized, statementYear, helpers });
  if (!parsed) {
    return null;
  }
  if (/\b(account summary|payment information|interest charge calculation)\b/i.test(parsed.description)) {
    return null;
  }
  return parsed;
}

function parseSpaceCoastLine({ normalized, statementYear, helpers }) {
  const parsed = parseDualDateAmountLine({ normalized, statementYear, helpers });
  if (!parsed) {
    return null;
  }
  if (/\b(shares and deposits|withdrawals and debits|dividends paid)\b/i.test(parsed.description)) {
    return null;
  }
  return parsed;
}

function parseCashAppLine({ normalized, statementYear, helpers }) {
  const monthMatch = normalized.match(
    /^(?<month>jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(?<day>\d{1,2})\s+(?<description>.+?)\s+(?<amount>\(?-?\$?\d{1,3}(?:,\d{3})*\.\d{2}\)?)$/i,
  );
  if (!monthMatch?.groups || typeof helpers?.parseDateToken !== "function") {
    return parseDualDateAmountLine({ normalized, statementYear, helpers });
  }

  const date = helpers.parseDateToken(`${monthMatch.groups.month} ${monthMatch.groups.day}`, statementYear);
  if (!date?.value) {
    return null;
  }

  const description = normalizeDescription(monthMatch.groups.description);
  if (description.length < 3) {
    return null;
  }

  const amount = parseAmountWithIndicator(monthMatch.groups.amount, null, helpers);
  if (amount === null) {
    return null;
  }

  if (/\b(cash app summary|monthly statement|ending cash balance)\b/i.test(description)) {
    return null;
  }

  return {
    postedDate: date.value,
    amount,
    description,
    rawLine: normalized,
  };
}

function createAdapter({ institution, method, noiseWords = [], lineParser = null }) {
  return Object.freeze({
    institution: normalizeInstitution(institution),
    method,
    fallbackToGeneric: false,
    lineParser,
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
  lineParser: null,
  noiseWords: Object.freeze([]),
});

const ADAPTERS_BY_INSTITUTION = Object.freeze({
  AMEX: createAdapter({
    institution: "AMEX",
    method: "AMEX_V1",
    lineParser: parseAmexLine,
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
    lineParser: parseBluevineLine,
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
    lineParser: parseCapitalOneLine,
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
    lineParser: parseCashAppLine,
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
    lineParser: parseDiscoverLine,
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
    lineParser: parseSpaceCoastLine,
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
