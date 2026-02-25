import test from "node:test";
import assert from "node:assert/strict";
import { extractTextCandidatesFromPdfBuffer } from "../apps/api/src/services/parser/pdf-text-extractor.mjs";

test("extractor keeps human text operators and drops numeric/operator noise", () => {
  const fakePdf = [
    "%PDF-1.7",
    "1 0 obj",
    "<< /Type/Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R >> >> >>",
    "stream",
    "BT",
    "/F1 12 Tf",
    "72 720 Td",
    "(01/12 ONLINE PAYMENT RECEIVED 125.00 CR) Tj",
    "(1 0 4 246 28 803 31 1061 39 1427) Tj",
    "[(AMAZON ) 100 (MARKETPLACE PMTS 34.22)] TJ",
    "ET",
    "endstream",
    "endobj",
  ].join("\n");

  const candidates = extractTextCandidatesFromPdfBuffer(Buffer.from(fakePdf, "latin1"), 500);
  assert.equal(candidates.some((line) => line.includes("ONLINE PAYMENT RECEIVED")), true);
  assert.equal(candidates.some((line) => line.includes("AMAZON MARKETPLACE PMTS 34.22")), true);
  assert.equal(candidates.some((line) => line.includes("1 0 4 246 28 803")), false);
  assert.equal(candidates.some((line) => line.includes("/Type/Page")), false);
});
