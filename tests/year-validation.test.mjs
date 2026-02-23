import test from "node:test";
import assert from "node:assert/strict";
import { detectFolderYearMismatch, inferStatementPeriod } from "../apps/api/src/services/parser/statement-parser.mjs";

test("detects year mismatch when 2025 statement appears under /2024", () => {
  const root = "D:/Taxes/2024";
  const file = "D:/Taxes/2024/Discover2024/Discover-AccountActivity-20251012.pdf";
  const period = inferStatementPeriod(file);
  assert.equal(period.year, 2025);
  assert.equal(detectFolderYearMismatch(root, file, period.year), true);
});

test("does not flag mismatch for matching year", () => {
  const root = "D:/Taxes/2024";
  const file = "D:/Taxes/2024/Amex2024/2024-12-03.pdf";
  const period = inferStatementPeriod(file);
  assert.equal(period.year, 2024);
  assert.equal(detectFolderYearMismatch(root, file, period.year), false);
});
