import test from "node:test";
import assert from "node:assert/strict";
import {
  GENERIC_PARSER_ADAPTER,
  hasInstitutionAdapter,
  listSupportedInstitutions,
  resolveParserAdapter,
} from "../apps/api/src/services/parser/institution-adapters.mjs";

test("supported institutions resolve to non-fallback parser adapters", () => {
  const institutions = listSupportedInstitutions();
  assert.deepEqual(institutions, [
    "AMEX",
    "BLUEVINE",
    "CAPITAL_ONE",
    "CASH_APP",
    "DISCOVER",
    "SPACE_COAST",
  ]);

  for (const institution of institutions) {
    assert.equal(hasInstitutionAdapter(institution), true);
    const adapter = resolveParserAdapter(institution);
    assert.equal(adapter.institution, institution);
    assert.equal(adapter.fallbackToGeneric, false);
    assert.match(adapter.method, /_V1$/);
  }
});

test("unknown institution falls back to generic parser adapter", () => {
  const adapter = resolveParserAdapter("NOT_A_REAL_BANK");
  assert.deepEqual(adapter, GENERIC_PARSER_ADAPTER);
  assert.equal(adapter.fallbackToGeneric, true);
});
