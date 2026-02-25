import test from "node:test";
import assert from "node:assert/strict";
import { parseTransactionLineByInstitution } from "../apps/api/src/services/parser/statement-parser.mjs";

test("AMEX adapter parses CR indicator and prefers posted date when dual dates exist", () => {
  const line = "01/12 01/13 ONLINE PAYMENT RECEIVED 125.00 CR";
  const amex = parseTransactionLineByInstitution({
    line,
    statementYear: 2024,
    institution: "AMEX",
  });
  const generic = parseTransactionLineByInstitution({
    line,
    statementYear: 2024,
    institution: "UNKNOWN_BANK",
  });

  assert.ok(amex);
  assert.equal(amex.postedDate, "2024-01-13");
  assert.equal(amex.amount, -125);
  assert.equal(amex.description, "ONLINE PAYMENT RECEIVED");

  assert.ok(generic);
  assert.equal(generic.postedDate, "2024-01-12");
  assert.equal(generic.amount, 125);
});

test("DISCOVER adapter parses standard merchant lines with posted date", () => {
  const line = "02/01 02/02 WALMART SUPERCENTER #1234 84.27";
  const parsed = parseTransactionLineByInstitution({
    line,
    statementYear: 2024,
    institution: "DISCOVER",
  });

  assert.ok(parsed);
  assert.equal(parsed.postedDate, "2024-02-02");
  assert.equal(parsed.amount, 84.27);
  assert.equal(parsed.description, "WALMART SUPERCENTER #1234");
});

test("metadata-like rows are blocked from parsing for adapter and generic parser", () => {
  const line = "01/31 AMERICAN EXPRESS ACCOUNT SUMMARY 200.00";
  const amex = parseTransactionLineByInstitution({
    line,
    statementYear: 2024,
    institution: "AMEX",
  });
  const generic = parseTransactionLineByInstitution({
    line,
    statementYear: 2024,
    institution: "UNKNOWN_BANK",
  });

  assert.equal(amex, null);
  assert.equal(generic, null);
});

test("generic parser blocks metadata-prefixed rows that include dates and amounts", () => {
  const line = "STATEMENT PERIOD: 03/01/2024 - 03/31/2024 1,250.00";
  const parsed = parseTransactionLineByInstitution({
    line,
    statementYear: 2024,
    institution: "UNKNOWN_BANK",
  });
  assert.equal(parsed, null);
});

test("parser rejects oversized PDF-instruction lines", () => {
  const line =
    "1 0 4 246 28 803 31 1061 39 1427 42 1703 << /Type/Page /Parent 2 0 R /Resources << /Font << /FN4 7 0 R >> >> BT 0 0 Td 1 0 0 1 0 0 Tm 511.200 805.440 Td [(p. 1/5)] TJ ET 01/28/24 188.22";
  const parsed = parseTransactionLineByInstitution({
    line,
    statementYear: 2024,
    institution: "AMEX",
  });
  assert.equal(parsed, null);
});

test("remaining institution adapters parse representative lines", () => {
  const cases = [
    {
      institution: "BLUEVINE",
      line: "03/05 PAYROLL TRANSFER 2,500.00",
      postedDate: "2024-03-05",
      amount: 2500,
      description: "PAYROLL TRANSFER",
    },
    {
      institution: "CAPITAL_ONE",
      line: "04/15 04/16 AMAZON MARKETPLACE PMTS 34.22",
      postedDate: "2024-04-16",
      amount: 34.22,
      description: "AMAZON MARKETPLACE PMTS",
    },
    {
      institution: "CASH_APP",
      line: "Jan 14 CASH CARD STARBUCKS 6.45",
      postedDate: "2024-01-14",
      amount: 6.45,
      description: "CASH CARD STARBUCKS",
    },
    {
      institution: "SPACE_COAST",
      line: "05/10 REFUND ADJUSTMENT 45.00 CR",
      postedDate: "2024-05-10",
      amount: -45,
      description: "REFUND ADJUSTMENT",
    },
  ];

  for (const sample of cases) {
    const parsed = parseTransactionLineByInstitution({
      line: sample.line,
      statementYear: 2024,
      institution: sample.institution,
    });
    assert.ok(parsed);
    assert.equal(parsed.postedDate, sample.postedDate);
    assert.equal(parsed.amount, sample.amount);
    assert.equal(parsed.description, sample.description);
  }
});
