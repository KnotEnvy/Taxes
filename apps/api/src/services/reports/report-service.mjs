import {
  CLASSIFICATION_METHOD,
  CONFIDENCE_THRESHOLD,
  ENTITY_TYPES,
  REVIEW_REASON,
  REVIEW_STATUS,
} from "../../domain/constants.mjs";
import { getTaxonomyForEntityYear } from "../../domain/taxonomies.mjs";
import { isDateWithinRange } from "../../utils/time.mjs";

const NON_DEDUCTIBLE_CATEGORY_CODES = new Set(["owner_draw"]);
const CARD_INSTITUTIONS = new Set(["AMEX", "CAPITAL_ONE", "DISCOVER"]);

function resolveEntityTypeForYear({ tenantId, year, profiles }) {
  const date = `${year}-12-31`;
  const safeProfiles = Array.isArray(profiles) ? profiles : [];
  const profile = safeProfiles.find(
    (item) => item.tenantId === tenantId && isDateWithinRange(date, item.effectiveFrom, item.effectiveTo ?? null),
  );
  return profile?.entityType ?? ENTITY_TYPES.SOLE_PROP;
}

function roundCurrency(value) {
  const safe = Number.isFinite(value) ? value : 0;
  return Number.parseFloat(safe.toFixed(2));
}

function roundRatio(value) {
  const safe = Number.isFinite(value) ? value : 0;
  return Number.parseFloat(safe.toFixed(4));
}

function createEmptyCategoryMap(taxonomy) {
  const out = new Map();
  for (const category of taxonomy.categories) {
    out.set(category.code, {
      categoryCode: category.code,
      displayName: category.label,
      irsForm: category.irsForm,
      irsLineRef: category.irsLineRef,
      total: 0,
      count: 0,
    });
  }
  return out;
}

function buildReportContext({ tenantId, year, db }) {
  const entityType = resolveEntityTypeForYear({ tenantId, year, profiles: db.businessEntityProfiles });
  const taxonomy = getTaxonomyForEntityYear(entityType, year);
  if (!taxonomy) {
    throw new Error(`No taxonomy available for entityType=${entityType}, year=${year}`);
  }

  const transactions = db.transactions.filter((tx) => tx.tenantId === tenantId && tx.postedDate?.startsWith(`${year}-`));
  const tenantAccounts = db.financialAccounts.filter((account) => account.tenantId === tenantId);
  const accountById = new Map(tenantAccounts.map((account) => [account.id, account]));

  return {
    tenantId,
    year,
    db,
    entityType,
    taxonomy,
    transactions,
    tenantAccounts,
    accountById,
    generatedAt: new Date().toISOString(),
  };
}

function buildCategoryRows({ transactions, taxonomy, predicate, normalizeTotal }) {
  const categories = createEmptyCategoryMap(taxonomy);
  for (const tx of transactions) {
    if (!predicate(tx)) {
      continue;
    }
    const bucket = categories.get(tx.categoryCode) ?? categories.get("other_expense");
    if (!bucket) {
      continue;
    }
    bucket.total += normalizeTotal(tx.amount);
    bucket.count += 1;
  }

  return [...categories.values()]
    .filter((row) => row.count > 0)
    .map((row) => ({
      ...row,
      total: roundCurrency(row.total),
    }))
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

function buildIncomeSourceRows({ transactions, accountById }) {
  const buckets = new Map();
  for (const tx of transactions) {
    if (!(tx.amount < 0)) {
      continue;
    }
    const account = accountById.get(tx.financialAccountId) ?? null;
    const key = tx.financialAccountId ?? `unknown_${account?.institution ?? "unknown"}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        financialAccountId: tx.financialAccountId ?? null,
        institution: account?.institution ?? "UNKNOWN",
        accountLabel: account?.accountLabel ?? "Unknown account",
        total: 0,
        count: 0,
      });
    }
    const bucket = buckets.get(key);
    bucket.total += Math.abs(tx.amount);
    bucket.count += 1;
  }

  return [...buckets.values()]
    .map((row) => ({
      ...row,
      total: roundCurrency(row.total),
    }))
    .sort((a, b) => b.total - a.total);
}

function summarizeYear({ transactions }) {
  let grossInflows = 0;
  let totalOutflows = 0;
  let inflowCount = 0;
  let outflowCount = 0;

  for (const tx of transactions) {
    if (tx.amount < 0) {
      grossInflows += Math.abs(tx.amount);
      inflowCount += 1;
    } else {
      totalOutflows += tx.amount;
      outflowCount += 1;
    }
  }

  return {
    grossInflows: roundCurrency(grossInflows),
    totalOutflows: roundCurrency(totalOutflows),
    inflowCount,
    outflowCount,
  };
}

function classifyBalanceSheetBucket(account) {
  const institution = (account.institution ?? "").toUpperCase();
  const label = (account.accountLabel ?? "").toLowerCase();

  if (CARD_INSTITUTIONS.has(institution) || /\b(credit|card|amex|discover)\b/.test(label)) {
    return {
      section: "LIABILITIES",
      group: "Credit Cards",
    };
  }
  if (/\b(loan|line of credit|loc|payable|debt)\b/.test(label)) {
    return {
      section: "LIABILITIES",
      group: "Loans Payable",
    };
  }
  if (/\b(tax[_\s-]?savings|reserve)\b/.test(label)) {
    return {
      section: "ASSETS",
      group: "Restricted Cash",
    };
  }

  return {
    section: "ASSETS",
    group: "Cash and Equivalents",
  };
}

function buildBalanceSheetRows({ transactions, tenantAccounts }) {
  const txByAccount = new Map();
  for (const tx of transactions) {
    if (!tx.financialAccountId) {
      continue;
    }
    if (!txByAccount.has(tx.financialAccountId)) {
      txByAccount.set(tx.financialAccountId, []);
    }
    txByAccount.get(tx.financialAccountId).push(tx);
  }

  return tenantAccounts
    .map((account) => {
      const rows = txByAccount.get(account.id) ?? [];
      let debits = 0;
      let credits = 0;
      let signedNet = 0;

      for (const tx of rows) {
        signedNet += tx.amount;
        if (tx.amount >= 0) {
          debits += tx.amount;
        } else {
          credits += Math.abs(tx.amount);
        }
      }

      const classification = classifyBalanceSheetBucket(account);
      const estimatedEndingBalance = classification.section === "LIABILITIES" ? signedNet : -signedNet;

      return {
        financialAccountId: account.id,
        institution: account.institution,
        accountLabel: account.accountLabel,
        section: classification.section,
        group: classification.group,
        debitActivity: roundCurrency(debits),
        creditActivity: roundCurrency(credits),
        netActivity: roundCurrency(signedNet),
        estimatedEndingBalance: roundCurrency(estimatedEndingBalance),
      };
    })
    .sort((a, b) => Math.abs(b.estimatedEndingBalance) - Math.abs(a.estimatedEndingBalance));
}

function buildMonthlyTrendRows(transactions) {
  const buckets = new Map();
  for (const tx of transactions) {
    const month = tx.postedDate?.slice(0, 7);
    if (!month || month.length !== 7) {
      continue;
    }
    if (!buckets.has(month)) {
      buckets.set(month, { month, inflows: 0, outflows: 0 });
    }
    const bucket = buckets.get(month);
    if (tx.amount < 0) {
      bucket.inflows += Math.abs(tx.amount);
    } else {
      bucket.outflows += tx.amount;
    }
  }

  return [...buckets.values()]
    .map((row) => ({
      month: row.month,
      inflows: roundCurrency(row.inflows),
      outflows: roundCurrency(row.outflows),
      netCashFlow: roundCurrency(row.inflows - row.outflows),
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

function summarizeCompliance({ tenantId, db, transactions }) {
  const openReviewItems = db.reviewQueue.filter(
    (item) => item.tenantId === tenantId && item.status === REVIEW_STATUS.OPEN,
  ).length;
  const openParseWarnings = db.reviewQueue.filter(
    (item) =>
      item.tenantId === tenantId && item.status === REVIEW_STATUS.OPEN && item.reason === REVIEW_REASON.PARSE_WARNING,
  ).length;
  const lowConfidenceTransactions = transactions.filter(
    (tx) => Number.isFinite(tx.confidence) && tx.confidence < CONFIDENCE_THRESHOLD,
  ).length;
  const needsReviewTransactions = transactions.filter((tx) => tx.needsReview === true).length;
  const ruleClassified = transactions.filter((tx) => tx.classificationMethod === CLASSIFICATION_METHOD.RULE).length;
  const aiClassified = transactions.filter((tx) => tx.classificationMethod === CLASSIFICATION_METHOD.AI).length;
  const fallbackClassified = transactions.filter(
    (tx) => tx.classificationMethod === CLASSIFICATION_METHOD.FALLBACK,
  ).length;
  const manualClassified = transactions.filter((tx) => tx.classificationMethod === CLASSIFICATION_METHOD.MANUAL).length;

  return {
    openReviewItems,
    openParseWarnings,
    lowConfidenceTransactions,
    needsReviewTransactions,
    classificationMix: {
      rule: ruleClassified,
      ai: aiClassified,
      fallback: fallbackClassified,
      manual: manualClassified,
    },
  };
}

function calculateDeductibleTotals(transactions) {
  let deductibleExpenses = 0;
  let nonDeductibleExpenses = 0;

  for (const tx of transactions) {
    if (!(tx.amount > 0)) {
      continue;
    }
    if (NON_DEDUCTIBLE_CATEGORY_CODES.has(tx.categoryCode)) {
      nonDeductibleExpenses += tx.amount;
      continue;
    }
    deductibleExpenses += tx.amount;
  }

  return {
    deductibleExpenses: roundCurrency(deductibleExpenses),
    nonDeductibleExpenses: roundCurrency(nonDeductibleExpenses),
  };
}

export function buildTaxSummary({ tenantId, year, db }) {
  const context = buildReportContext({ tenantId, year, db });
  const rows = buildCategoryRows({
    transactions: context.transactions,
    taxonomy: context.taxonomy,
    predicate: (tx) => Number.isFinite(tx.amount),
    normalizeTotal: (amount) => amount,
  });

  return {
    tenantId,
    year,
    entityType: context.entityType,
    taxonomyId: context.taxonomy.id,
    taxonomyTitle: context.taxonomy.title,
    generatedAt: context.generatedAt,
    rows,
  };
}

export function buildIncomeStatement({ tenantId, year, db }) {
  const context = buildReportContext({ tenantId, year, db });
  const yearly = summarizeYear({ transactions: context.transactions });
  const totals = calculateDeductibleTotals(context.transactions);
  const incomeSourceRows = buildIncomeSourceRows({
    transactions: context.transactions,
    accountById: context.accountById,
  });
  const expenseRows = buildCategoryRows({
    transactions: context.transactions,
    taxonomy: context.taxonomy,
    predicate: (tx) => tx.amount > 0,
    normalizeTotal: (amount) => amount,
  });

  const netOperatingIncome = roundCurrency(yearly.grossInflows - totals.deductibleExpenses);
  const netIncomeAfterOwnerDraw = roundCurrency(netOperatingIncome - totals.nonDeductibleExpenses);

  return {
    tenantId,
    year,
    entityType: context.entityType,
    taxonomyId: context.taxonomy.id,
    taxonomyTitle: context.taxonomy.title,
    generatedAt: context.generatedAt,
    assumptions: [
      "Gross inflows are estimated from statement credits (negative signed transaction amounts).",
      "Expenses are estimated from statement debits (positive signed transaction amounts).",
    ],
    totals: {
      grossInflows: yearly.grossInflows,
      totalOutflows: yearly.totalOutflows,
      deductibleExpenses: totals.deductibleExpenses,
      ownerDrawAndNonDeductible: totals.nonDeductibleExpenses,
      netOperatingIncome,
      netIncomeAfterOwnerDraw,
      inflowCount: yearly.inflowCount,
      outflowCount: yearly.outflowCount,
    },
    incomeSourceRows,
    expenseRows,
  };
}

export function buildBalanceSheet({ tenantId, year, db }) {
  const context = buildReportContext({ tenantId, year, db });
  const rows = buildBalanceSheetRows({
    transactions: context.transactions,
    tenantAccounts: context.tenantAccounts,
  });

  const assetTotal = roundCurrency(
    rows.filter((row) => row.section === "ASSETS").reduce((sum, row) => sum + row.estimatedEndingBalance, 0),
  );
  const liabilityTotal = roundCurrency(
    rows.filter((row) => row.section === "LIABILITIES").reduce((sum, row) => sum + row.estimatedEndingBalance, 0),
  );
  const equityEstimate = roundCurrency(assetTotal - liabilityTotal);

  return {
    tenantId,
    year,
    entityType: context.entityType,
    generatedAt: context.generatedAt,
    assumptions: [
      "Balances are estimated from net in-year statement activity for each linked account.",
      "Opening balances are not available from statement transactions and are treated as zero.",
    ],
    totals: {
      totalAssetsEstimate: assetTotal,
      totalLiabilitiesEstimate: liabilityTotal,
      equityEstimate,
    },
    rows,
  };
}

export function buildFinancialInsights({ tenantId, year, db }) {
  const context = buildReportContext({ tenantId, year, db });
  const yearly = summarizeYear({ transactions: context.transactions });
  const totals = calculateDeductibleTotals(context.transactions);
  const netOperatingIncome = roundCurrency(yearly.grossInflows - totals.deductibleExpenses);
  const netAfterOwnerDraw = roundCurrency(netOperatingIncome - totals.nonDeductibleExpenses);
  const balanceSheet = buildBalanceSheet({ tenantId, year, db });
  const compliance = summarizeCompliance({
    tenantId,
    db,
    transactions: context.transactions,
  });

  const expenseRows = buildCategoryRows({
    transactions: context.transactions,
    taxonomy: context.taxonomy,
    predicate: (tx) => tx.amount > 0,
    normalizeTotal: (amount) => amount,
  }).slice(0, 5);
  const inflowRows = buildIncomeSourceRows({
    transactions: context.transactions,
    accountById: context.accountById,
  }).slice(0, 5);

  const averageOutflow = yearly.outflowCount === 0 ? 0 : roundCurrency(yearly.totalOutflows / yearly.outflowCount);
  const netMargin = yearly.grossInflows === 0 ? 0 : roundRatio(netAfterOwnerDraw / yearly.grossInflows);

  return {
    tenantId,
    year,
    entityType: context.entityType,
    generatedAt: context.generatedAt,
    kpis: {
      grossInflows: yearly.grossInflows,
      totalOutflows: yearly.totalOutflows,
      netOperatingIncome,
      netIncomeAfterOwnerDraw: netAfterOwnerDraw,
      netMargin,
      averageOutflow,
      openReviewItems: compliance.openReviewItems,
    },
    monthlyTrend: buildMonthlyTrendRows(context.transactions),
    topExpenseCategories: expenseRows,
    topIncomeSources: inflowRows,
    balanceSheetTotals: balanceSheet.totals,
    compliance,
  };
}

export function buildTaxDetailBreakdown({ tenantId, year, db }) {
  const context = buildReportContext({ tenantId, year, db });
  const yearly = summarizeYear({ transactions: context.transactions });
  const totals = calculateDeductibleTotals(context.transactions);

  const deductibleRows = buildCategoryRows({
    transactions: context.transactions,
    taxonomy: context.taxonomy,
    predicate: (tx) => tx.amount > 0 && !NON_DEDUCTIBLE_CATEGORY_CODES.has(tx.categoryCode),
    normalizeTotal: (amount) => amount,
  });
  const nonDeductibleRows = buildCategoryRows({
    transactions: context.transactions,
    taxonomy: context.taxonomy,
    predicate: (tx) => tx.amount > 0 && NON_DEDUCTIBLE_CATEGORY_CODES.has(tx.categoryCode),
    normalizeTotal: (amount) => amount,
  });
  const creditRows = buildCategoryRows({
    transactions: context.transactions,
    taxonomy: context.taxonomy,
    predicate: (tx) => tx.amount < 0,
    normalizeTotal: (amount) => Math.abs(amount),
  });

  const estimatedTaxableIncome = roundCurrency(yearly.grossInflows - totals.deductibleExpenses);
  const baseTaxable = Math.max(estimatedTaxableIncome, 0);
  const estimatedFederalIncomeTax =
    context.entityType === ENTITY_TYPES.C_CORP
      ? roundCurrency(baseTaxable * 0.21)
      : roundCurrency(baseTaxable * 0.3);
  const estimatedSelfEmploymentTaxBase =
    context.entityType === ENTITY_TYPES.SOLE_PROP ? roundCurrency(baseTaxable * 0.9235) : null;
  const estimatedQuarterlyReserve =
    context.entityType === ENTITY_TYPES.SOLE_PROP ? roundCurrency(estimatedFederalIncomeTax / 4) : null;

  return {
    tenantId,
    year,
    entityType: context.entityType,
    taxonomyId: context.taxonomy.id,
    taxonomyTitle: context.taxonomy.title,
    generatedAt: context.generatedAt,
    assumptions: [
      "Tax estimates are directional only and should be reviewed by a tax professional.",
      "Credits/offsets are estimated from statement credits and may include non-income transfers.",
    ],
    summary: {
      grossInflows: yearly.grossInflows,
      deductibleExpenses: totals.deductibleExpenses,
      nonDeductibleExpenses: totals.nonDeductibleExpenses,
      estimatedTaxableIncome,
      estimatedFederalIncomeTax,
      estimatedSelfEmploymentTaxBase,
      estimatedQuarterlyReserve,
    },
    deductions: deductibleRows,
    nonDeductible: nonDeductibleRows,
    creditsAndOffsets: creditRows,
    compliance: summarizeCompliance({
      tenantId,
      db,
      transactions: context.transactions,
    }),
  };
}

export function taxSummaryToCsv(summary) {
  const header = [
    "year",
    "entityType",
    "taxonomyId",
    "categoryCode",
    "displayName",
    "irsForm",
    "irsLineRef",
    "count",
    "total",
  ].join(",");

  const bodyLines = summary.rows.map((row) =>
    [
      summary.year,
      summary.entityType,
      summary.taxonomyId,
      row.categoryCode,
      `"${row.displayName.replaceAll('"', '""')}"`,
      row.irsForm,
      row.irsLineRef,
      row.count,
      row.total.toFixed(2),
    ].join(","),
  );

  return `${header}\n${bodyLines.join("\n")}\n`;
}
