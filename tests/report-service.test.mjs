import test from "node:test";
import assert from "node:assert/strict";
import { ENTITY_TYPES, REVIEW_REASON, REVIEW_STATUS } from "../apps/api/src/domain/constants.mjs";
import {
  buildBalanceSheet,
  buildFinancialInsights,
  buildIncomeStatement,
  buildTaxDetailBreakdown,
  buildTaxSummary,
} from "../apps/api/src/services/reports/report-service.mjs";

function buildFixtureDb() {
  const tenantId = "tenant_reports";
  return {
    tenants: [
      {
        id: tenantId,
        name: "Reports Tenant",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    businessEntityProfiles: [
      {
        id: "profile_2024",
        tenantId,
        entityType: ENTITY_TYPES.SOLE_PROP,
        effectiveFrom: "2024-01-01",
        effectiveTo: "2024-12-31",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "profile_2025",
        tenantId,
        entityType: ENTITY_TYPES.C_CORP,
        effectiveFrom: "2025-01-01",
        effectiveTo: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    financialAccounts: [
      {
        id: "acct_bank",
        tenantId,
        institution: "BLUEVINE",
        accountLabel: "checking 1111",
        last4: "1111",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "acct_card",
        tenantId,
        institution: "AMEX",
        accountLabel: "amex business 2222",
        last4: "2222",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "acct_tax",
        tenantId,
        institution: "BLUEVINE",
        accountLabel: "tax_savings 3333",
        last4: "3333",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    statements: [],
    transactions: [
      {
        id: "tx1",
        tenantId,
        statementId: "stmt1",
        financialAccountId: "acct_bank",
        postedDate: "2024-01-05",
        amount: -2500,
        categoryCode: "other_expense",
        classificationMethod: "RULE",
        confidence: 0.99,
        needsReview: false,
      },
      {
        id: "tx2",
        tenantId,
        statementId: "stmt1",
        financialAccountId: "acct_bank",
        postedDate: "2024-01-11",
        amount: 300,
        categoryCode: "supplies",
        classificationMethod: "RULE",
        confidence: 0.99,
        needsReview: false,
      },
      {
        id: "tx3",
        tenantId,
        statementId: "stmt1",
        financialAccountId: "acct_bank",
        postedDate: "2024-01-15",
        amount: 200,
        categoryCode: "advertising",
        classificationMethod: "AI",
        confidence: 0.9,
        needsReview: false,
      },
      {
        id: "tx4",
        tenantId,
        statementId: "stmt2",
        financialAccountId: "acct_card",
        postedDate: "2024-01-20",
        amount: 400,
        categoryCode: "office_expense",
        classificationMethod: "RULE",
        confidence: 0.91,
        needsReview: false,
      },
      {
        id: "tx5",
        tenantId,
        statementId: "stmt2",
        financialAccountId: "acct_card",
        postedDate: "2024-01-25",
        amount: -150,
        categoryCode: "other_expense",
        classificationMethod: "RULE",
        confidence: 0.92,
        needsReview: false,
      },
      {
        id: "tx6",
        tenantId,
        statementId: "stmt3",
        financialAccountId: "acct_bank",
        postedDate: "2024-01-27",
        amount: 100,
        categoryCode: "owner_draw",
        classificationMethod: "MANUAL",
        confidence: 1,
        needsReview: false,
      },
      {
        id: "tx7",
        tenantId,
        statementId: "stmt3",
        financialAccountId: "acct_bank",
        postedDate: "2024-02-02",
        amount: 50,
        categoryCode: "taxes_licenses",
        classificationMethod: "FALLBACK",
        confidence: 0.5,
        needsReview: true,
      },
      {
        id: "tx8",
        tenantId,
        statementId: "stmt4",
        financialAccountId: "acct_bank",
        postedDate: "2025-01-03",
        amount: -1000,
        categoryCode: "other_expense",
        classificationMethod: "RULE",
        confidence: 0.97,
        needsReview: false,
      },
      {
        id: "tx9",
        tenantId,
        statementId: "stmt4",
        financialAccountId: "acct_bank",
        postedDate: "2025-01-10",
        amount: 400,
        categoryCode: "wages",
        classificationMethod: "RULE",
        confidence: 0.97,
        needsReview: false,
      },
    ],
    reviewQueue: [
      {
        id: "review_parse",
        tenantId,
        reason: REVIEW_REASON.PARSE_WARNING,
        status: REVIEW_STATUS.OPEN,
      },
      {
        id: "review_old",
        tenantId,
        reason: REVIEW_REASON.LOW_CONFIDENCE,
        status: REVIEW_STATUS.RESOLVED,
      },
    ],
    auditEvents: [],
    rules: [],
  };
}

test("buildTaxSummary and buildIncomeStatement aggregate inflows/outflows", () => {
  const db = buildFixtureDb();
  const summary = buildTaxSummary({ tenantId: "tenant_reports", year: 2024, db });
  assert.equal(summary.entityType, ENTITY_TYPES.SOLE_PROP);
  assert.equal(summary.rows.some((row) => row.categoryCode === "supplies"), true);

  const report = buildIncomeStatement({ tenantId: "tenant_reports", year: 2024, db });
  assert.equal(report.totals.grossInflows, 2650);
  assert.equal(report.totals.totalOutflows, 1050);
  assert.equal(report.totals.deductibleExpenses, 950);
  assert.equal(report.totals.ownerDrawAndNonDeductible, 100);
  assert.equal(report.totals.netOperatingIncome, 1700);
  assert.equal(report.totals.netIncomeAfterOwnerDraw, 1600);
});

test("buildBalanceSheet estimates asset and liability balances from activity", () => {
  const db = buildFixtureDb();
  const report = buildBalanceSheet({ tenantId: "tenant_reports", year: 2024, db });

  const cashRow = report.rows.find((row) => row.financialAccountId === "acct_bank");
  assert.ok(cashRow);
  assert.equal(cashRow.section, "ASSETS");
  assert.equal(cashRow.estimatedEndingBalance, 1850);

  const cardRow = report.rows.find((row) => row.financialAccountId === "acct_card");
  assert.ok(cardRow);
  assert.equal(cardRow.section, "LIABILITIES");
  assert.equal(cardRow.estimatedEndingBalance, 250);

  assert.equal(report.totals.totalAssetsEstimate, 1850);
  assert.equal(report.totals.totalLiabilitiesEstimate, 250);
  assert.equal(report.totals.equityEstimate, 1600);
});

test("buildFinancialInsights returns KPI, trend, and compliance signals", () => {
  const db = buildFixtureDb();
  const report = buildFinancialInsights({ tenantId: "tenant_reports", year: 2024, db });

  assert.equal(report.kpis.grossInflows, 2650);
  assert.equal(report.kpis.netMargin, 0.6038);
  assert.equal(report.kpis.openReviewItems, 1);
  assert.equal(report.monthlyTrend.length, 2);
  assert.equal(report.monthlyTrend[0].month, "2024-01");
  assert.equal(report.compliance.openParseWarnings, 1);
  assert.equal(report.compliance.lowConfidenceTransactions, 1);
  assert.equal(report.compliance.classificationMix.rule, 4);
});

test("buildTaxDetailBreakdown applies c-corp tax estimate logic", () => {
  const db = buildFixtureDb();
  const report = buildTaxDetailBreakdown({ tenantId: "tenant_reports", year: 2025, db });

  assert.equal(report.entityType, ENTITY_TYPES.C_CORP);
  assert.equal(report.summary.estimatedTaxableIncome, 600);
  assert.equal(report.summary.estimatedFederalIncomeTax, 126);
  assert.equal(report.summary.estimatedSelfEmploymentTaxBase, null);
  assert.equal(report.summary.estimatedQuarterlyReserve, null);
  assert.equal(report.deductions.some((row) => row.categoryCode === "wages"), true);
});
