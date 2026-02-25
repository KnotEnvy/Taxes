import { parseTransactionLineByInstitution } from "../apps/api/src/services/parser/statement-parser.mjs";

const SAMPLE_YEAR = 2024;
const PRECISION_THRESHOLD = 0.95;

const SAMPLES = Object.freeze([
  { institution: "AMEX", line: "01/12 01/13 ONLINE PAYMENT RECEIVED 125.00 CR", expectedTransaction: true },
  { institution: "AMEX", line: "01/20 01/21 UBER TRIP HELP.UBER.COM 23.45", expectedTransaction: true },
  { institution: "AMEX", line: "01/31 AMERICAN EXPRESS ACCOUNT SUMMARY 200.00", expectedTransaction: false },
  { institution: "AMEX", line: "STATEMENT DATE: 01/31/2024 200.00", expectedTransaction: false },

  { institution: "DISCOVER", line: "02/01 02/02 WALMART SUPERCENTER #1234 84.27", expectedTransaction: true },
  { institution: "DISCOVER", line: "02/11 02/12 PAYMENT RECEIVED 250.00 CR", expectedTransaction: true },
  { institution: "DISCOVER", line: "02/28 DISCOVER ACCOUNT SUMMARY 500.00", expectedTransaction: false },
  { institution: "DISCOVER", line: "PAGE 2 OF 5 02/28/2024 500.00", expectedTransaction: false },

  { institution: "BLUEVINE", line: "03/05 PAYROLL TRANSFER 2,500.00", expectedTransaction: true },
  { institution: "BLUEVINE", line: "03/06 ACH CREDIT CLIENT PAYMENT 1,200.00", expectedTransaction: true },
  { institution: "BLUEVINE", line: "03/31 DAILY LEDGER BALANCE 10,000.00", expectedTransaction: false },
  { institution: "BLUEVINE", line: "ACCOUNT SUMMARY: 03/31/2024 10,000.00", expectedTransaction: false },

  { institution: "CAPITAL_ONE", line: "04/15 04/16 AMAZON MARKETPLACE PMTS 34.22", expectedTransaction: true },
  { institution: "CAPITAL_ONE", line: "04/18 04/19 STARBUCKS STORE 1021 6.75", expectedTransaction: true },
  { institution: "CAPITAL_ONE", line: "04/30 ACCOUNT SUMMARY 1,200.00", expectedTransaction: false },
  { institution: "CAPITAL_ONE", line: "PAYMENT INFORMATION: 04/30/2024 1,200.00", expectedTransaction: false },

  { institution: "CASH_APP", line: "Jan 14 CASH CARD STARBUCKS 6.45", expectedTransaction: true },
  { institution: "CASH_APP", line: "Feb 02 DIRECT DEPOSIT ACME INC 1200.00", expectedTransaction: true },
  { institution: "CASH_APP", line: "Mar 31 MONTHLY STATEMENT 100.00", expectedTransaction: false },
  { institution: "CASH_APP", line: "STATEMENT PERIOD: Mar 1, 2024 100.00", expectedTransaction: false },

  { institution: "SPACE_COAST", line: "05/10 REFUND ADJUSTMENT 45.00 CR", expectedTransaction: true },
  { institution: "SPACE_COAST", line: "05/15 DEBIT CARD PURCHASE HOME DEPOT 63.77", expectedTransaction: true },
  { institution: "SPACE_COAST", line: "05/31 SHARES AND DEPOSITS 500.00", expectedTransaction: false },
  { institution: "SPACE_COAST", line: "SUMMARY: 05/31/2024 500.00", expectedTransaction: false },

  { institution: "UNKNOWN_BANK", line: "06/10 ACME SERVICES 75.00", expectedTransaction: true },
  { institution: "UNKNOWN_BANK", line: "STATEMENT PERIOD: 06/01/2024 - 06/30/2024 300.00", expectedTransaction: false },
  {
    institution: "UNKNOWN_BANK",
    line: "1 0 4 246 28 803 31 1061 39 1427 << /Type/Page /Parent 2 0 R >> 01/28/2024 188.22",
    expectedTransaction: false,
  },
]);

function createStats() {
  return {
    tp: 0,
    fp: 0,
    tn: 0,
    fn: 0,
  };
}

function precision(stats) {
  const denom = stats.tp + stats.fp;
  return denom === 0 ? 1 : stats.tp / denom;
}

function recall(stats) {
  const denom = stats.tp + stats.fn;
  return denom === 0 ? 1 : stats.tp / denom;
}

const byInstitution = new Map();

for (const sample of SAMPLES) {
  const parsed = parseTransactionLineByInstitution({
    line: sample.line,
    statementYear: SAMPLE_YEAR,
    institution: sample.institution,
  });
  const predictedTransaction = Boolean(parsed);

  if (!byInstitution.has(sample.institution)) {
    byInstitution.set(sample.institution, createStats());
  }

  const stats = byInstitution.get(sample.institution);
  if (predictedTransaction && sample.expectedTransaction) stats.tp += 1;
  if (predictedTransaction && !sample.expectedTransaction) stats.fp += 1;
  if (!predictedTransaction && !sample.expectedTransaction) stats.tn += 1;
  if (!predictedTransaction && sample.expectedTransaction) stats.fn += 1;
}

let hasThresholdFailure = false;
for (const [institution, stats] of byInstitution.entries()) {
  const p = precision(stats);
  const r = recall(stats);
  if (p < PRECISION_THRESHOLD) {
    hasThresholdFailure = true;
  }
  // eslint-disable-next-line no-console
  console.log(
    `${institution}: precision=${p.toFixed(3)} recall=${r.toFixed(3)} tp=${stats.tp} fp=${stats.fp} fn=${stats.fn} tn=${stats.tn}`,
  );
}

if (hasThresholdFailure) {
  // eslint-disable-next-line no-console
  console.error(`Parser precision sample check failed. Required precision >= ${PRECISION_THRESHOLD.toFixed(2)}.`);
  process.exitCode = 1;
} else {
  // eslint-disable-next-line no-console
  console.log(`Parser precision sample check passed (threshold >= ${PRECISION_THRESHOLD.toFixed(2)}).`);
}
