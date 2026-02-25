import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseStatementPdf, parseTransactionLineByInstitution } from "../apps/api/src/services/parser/statement-parser.mjs";
import { extractTextCandidatesFromPdfBuffer } from "../apps/api/src/services/parser/pdf-text-extractor.mjs";

const DEFAULT_MAX_PER_INSTITUTION = 3;
const DEFAULT_SAMPLE_PER_INSTITUTION = 40;
const DEFAULT_SCORECARD_PATH = "data/parser-real-scorecard.json";
const DEFAULT_SAMPLES_PATH = "data/parser-real-samples.json";

const METADATA_HINT_PATTERN =
  /\b(statement|account|summary|balance|payment due|min(?:imum)? payment|interest|fees?|credit limit|available)\b/i;
const DATE_PATTERN = /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/;
const MONTH_DATE_PATTERN = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\b/i;
const AMOUNT_PATTERN = /(?:\(\$?\d{1,3}(?:,\d{3})*\.\d{2}\)|-?\$?\d{1,3}(?:,\d{3})*\.\d{2})/;

function parseArgs(argv) {
  const out = {
    command: "scorecard",
    tenantId: null,
    year: null,
    maxPerInstitution: DEFAULT_MAX_PER_INSTITUTION,
    samplePerInstitution: DEFAULT_SAMPLE_PER_INSTITUTION,
    output: null,
  };

  const args = [...argv];
  if (args.length > 0 && !args[0].startsWith("--")) {
    out.command = args.shift();
  }

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith("--")) {
      continue;
    }
    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    const value = inlineValue ?? args[i + 1];
    const consumeNext = inlineValue === undefined;
    if (consumeNext && args[i + 1]?.startsWith("--")) {
      continue;
    }

    if (rawKey === "tenantId") out.tenantId = value;
    if (rawKey === "year") out.year = Number.parseInt(value, 10);
    if (rawKey === "maxPerInstitution") out.maxPerInstitution = Number.parseInt(value, 10);
    if (rawKey === "samplePerInstitution") out.samplePerInstitution = Number.parseInt(value, 10);
    if (rawKey === "output") out.output = value;
    if (consumeNext) i += 1;
  }

  if (!Number.isFinite(out.maxPerInstitution) || out.maxPerInstitution < 1) {
    out.maxPerInstitution = DEFAULT_MAX_PER_INSTITUTION;
  }
  if (!Number.isFinite(out.samplePerInstitution) || out.samplePerInstitution < 1) {
    out.samplePerInstitution = DEFAULT_SAMPLE_PER_INSTITUTION;
  }
  if (!Number.isFinite(out.year)) {
    out.year = null;
  }

  return out;
}

function toIsoNow() {
  return new Date().toISOString();
}

function statKey(statement) {
  return `${statement.institution}|${statement.id}`;
}

function sampleKey(row) {
  return `${row.institution}|${row.statementId}|${row.line}`;
}

async function readDb(dbPath) {
  const payload = await readFile(dbPath, "utf8");
  return JSON.parse(payload);
}

function pickStatements(db, options) {
  const candidates = db.statements
    .filter((item) => item.storedPath)
    .filter((item) => (options.tenantId ? item.tenantId === options.tenantId : true))
    .filter((item) => (options.year ? item.statementYear === options.year : true))
    .filter((item) => item.status !== "ERROR")
    .sort((a, b) => {
      const inst = `${a.institution}`.localeCompare(`${b.institution}`);
      if (inst !== 0) {
        return inst;
      }
      return `${a.fileName}`.localeCompare(`${b.fileName}`);
    });

  const byInstitution = new Map();
  for (const statement of candidates) {
    const institution = statement.institution ?? "UNKNOWN";
    if (!byInstitution.has(institution)) {
      byInstitution.set(institution, []);
    }
    byInstitution.get(institution).push(statement);
  }

  const selected = [];
  for (const statements of byInstitution.values()) {
    selected.push(...statements.slice(0, options.maxPerInstitution));
  }
  return selected;
}

function updateAggregate(bucket, diagnostics, statementId) {
  bucket.statementCount += 1;
  bucket.textLines += diagnostics.textLines ?? 0;
  bucket.candidateLines += diagnostics.candidateLines ?? 0;
  bucket.parsedTransactions += diagnostics.parsedTransactions ?? 0;
  bucket.confidenceTotal += diagnostics.parserConfidence ?? 0;
  if ((diagnostics.parsedTransactions ?? 0) > 0) {
    bucket.statementsWithParsed += 1;
  }
  if ((diagnostics.candidateLines ?? 0) > 0) {
    bucket.statementsWithCandidates += 1;
  }
  bucket.statementIds.push(statementId);
}

function summarizeInstitutionStats(aggregate) {
  const statementCount = aggregate.statementCount || 1;
  return {
    statements: aggregate.statementCount,
    statementsWithCandidates: aggregate.statementsWithCandidates,
    statementsWithParsed: aggregate.statementsWithParsed,
    avgTextLines: Number.parseFloat((aggregate.textLines / statementCount).toFixed(2)),
    avgCandidateLines: Number.parseFloat((aggregate.candidateLines / statementCount).toFixed(2)),
    avgParsedTransactions: Number.parseFloat((aggregate.parsedTransactions / statementCount).toFixed(2)),
    avgParserConfidence: Number.parseFloat((aggregate.confidenceTotal / statementCount).toFixed(4)),
    statementIds: aggregate.statementIds,
  };
}

async function runScorecard({ workspaceRoot, dbPath, options }) {
  const db = await readDb(dbPath);
  const selectedStatements = pickStatements(db, options);
  const byInstitution = new Map();
  const statementRows = [];

  for (const statement of selectedStatements) {
    try {
      const result = await parseStatementPdf({
        filePath: statement.storedPath,
        statementYear: statement.statementYear ?? options.year ?? 2024,
        institution: statement.institution,
      });
      statementRows.push({
        statementId: statement.id,
        institution: statement.institution,
        fileName: statement.fileName,
        status: statement.status,
        diagnostics: result.diagnostics,
        previewTransactions: result.transactions.slice(0, 5),
      });

      const key = statement.institution ?? "UNKNOWN";
      if (!byInstitution.has(key)) {
        byInstitution.set(key, {
          statementCount: 0,
          statementsWithCandidates: 0,
          statementsWithParsed: 0,
          textLines: 0,
          candidateLines: 0,
          parsedTransactions: 0,
          confidenceTotal: 0,
          statementIds: [],
        });
      }
      updateAggregate(byInstitution.get(key), result.diagnostics, statement.id);
    } catch (error) {
      statementRows.push({
        statementId: statement.id,
        institution: statement.institution,
        fileName: statement.fileName,
        status: statement.status,
        error: error.message,
      });
    }
  }

  const institutionStats = {};
  for (const [institution, aggregate] of [...byInstitution.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    institutionStats[institution] = summarizeInstitutionStats(aggregate);
  }

  const output = {
    generatedAt: toIsoNow(),
    mode: "scorecard",
    source: {
      dbPath,
      tenantId: options.tenantId,
      year: options.year,
      maxPerInstitution: options.maxPerInstitution,
      selectedStatements: selectedStatements.length,
    },
    institutionStats,
    statementRows,
  };

  const outputPath = path.resolve(workspaceRoot, options.output ?? DEFAULT_SCORECARD_PATH);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");

  // eslint-disable-next-line no-console
  console.log(`Scorecard written: ${outputPath}`);
  for (const [institution, stats] of Object.entries(institutionStats)) {
    // eslint-disable-next-line no-console
    console.log(
      `${institution}: stmts=${stats.statements} candidates=${stats.avgCandidateLines} parsed=${stats.avgParsedTransactions} conf=${stats.avgParserConfidence}`,
    );
  }
}

function lineReadabilityScore(line) {
  const normalized = line.replace(/\s+/g, " ").trim();
  if (normalized.length < 8 || normalized.length > 260) {
    return Number.NEGATIVE_INFINITY;
  }
  const tokenCount = normalized.split(" ").filter(Boolean).length;
  if (tokenCount < 2) {
    return Number.NEGATIVE_INFINITY;
  }
  const letters = (normalized.match(/[A-Za-z]/g) ?? []).length;
  const digits = (normalized.match(/\d/g) ?? []).length;
  const weird = (normalized.match(/[^A-Za-z0-9\s.,\-/#:$()]/g) ?? []).length;
  if (letters < 4) {
    return Number.NEGATIVE_INFINITY;
  }
  return letters * 2 + digits - weird * 3;
}

function classifySampleLine(line, parsedPrediction) {
  const hasDate = DATE_PATTERN.test(line) || MONTH_DATE_PATTERN.test(line);
  const hasAmount = AMOUNT_PATTERN.test(line);
  const hasMetadata = METADATA_HINT_PATTERN.test(line);
  const tokenCount = line.split(" ").filter(Boolean).length;
  const phraseLike = tokenCount >= 4;

  if (parsedPrediction) {
    return "predicted_transaction";
  }
  if (hasDate && hasAmount && !hasMetadata) {
    return "date_amount_candidate";
  }
  if (hasMetadata && phraseLike) {
    return "metadata";
  }
  if ((hasDate || hasAmount) && phraseLike) {
    return "date_or_amount_only";
  }
  return "other";
}

function suggestionForLine(bucketType, parsedPrediction) {
  if (parsedPrediction) {
    return true;
  }
  if (bucketType === "metadata") {
    return false;
  }
  return null;
}

function sampleInstitutionRows(rows, maxRows) {
  const buckets = new Map([
    ["predicted_transaction", []],
    ["date_amount_candidate", []],
    ["metadata", []],
    ["date_or_amount_only", []],
    ["other", []],
  ]);

  for (const row of rows) {
    if (!buckets.has(row.bucketType)) {
      buckets.set(row.bucketType, []);
    }
    buckets.get(row.bucketType).push(row);
  }

  const selected = [];
  const quotas = new Map([
    ["predicted_transaction", Math.ceil(maxRows * 0.45)],
    ["date_amount_candidate", Math.ceil(maxRows * 0.25)],
    ["metadata", Math.ceil(maxRows * 0.2)],
    ["date_or_amount_only", Math.ceil(maxRows * 0.1)],
  ]);

  for (const [bucket, quota] of quotas.entries()) {
    const picks = (buckets.get(bucket) ?? []).slice(0, quota);
    selected.push(...picks);
  }

  if (selected.length < maxRows) {
    const leftovers = [...buckets.values()].flat();
    const seen = new Set(selected.map(sampleKey));
    for (const row of leftovers) {
      const key = sampleKey(row);
      if (seen.has(key)) {
        continue;
      }
      selected.push(row);
      seen.add(key);
      if (selected.length >= maxRows) {
        break;
      }
    }
  }

  return selected.slice(0, maxRows);
}

async function loadExistingSamples(outputPath) {
  try {
    await access(outputPath);
  } catch {
    return [];
  }
  const payload = await readFile(outputPath, "utf8");
  const parsed = JSON.parse(payload);
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (Array.isArray(parsed.samples)) {
    return parsed.samples;
  }
  return [];
}

async function runCollect({ workspaceRoot, dbPath, options }) {
  const db = await readDb(dbPath);
  const selectedStatements = pickStatements(db, options);
  const existingPath = path.resolve(workspaceRoot, options.output ?? DEFAULT_SAMPLES_PATH);
  const existingSamples = await loadExistingSamples(existingPath);
  const existingByKey = new Map(existingSamples.map((row) => [sampleKey(row), row]));

  const rowsByInstitution = new Map();

  for (const statement of selectedStatements) {
    const bytes = await readFile(statement.storedPath);
    const lines = extractTextCandidatesFromPdfBuffer(bytes, 9000);
    for (const line of lines) {
      const normalized = line.replace(/\s+/g, " ").trim();
      const readability = lineReadabilityScore(normalized);
      if (!Number.isFinite(readability) || readability < 6) {
        continue;
      }
      const parsedPrediction = parseTransactionLineByInstitution({
        line: normalized,
        statementYear: statement.statementYear ?? options.year ?? 2024,
        institution: statement.institution,
      });
      const bucketType = classifySampleLine(normalized, Boolean(parsedPrediction));
      if (bucketType === "other") {
        continue;
      }

      const row = {
        id: `sample_${createHash("sha1").update(`${statement.id}|${normalized}`).digest("hex").slice(0, 20)}`,
        tenantId: statement.tenantId,
        statementId: statement.id,
        fileName: statement.fileName,
        institution: statement.institution,
        statementYear: statement.statementYear,
        line: normalized,
        bucketType,
        readability,
        parserPrediction: Boolean(parsedPrediction),
        parserParsed: parsedPrediction
          ? {
              postedDate: parsedPrediction.postedDate,
              amount: parsedPrediction.amount,
              description: parsedPrediction.description,
            }
          : null,
        suggestedExpectedTransaction: suggestionForLine(bucketType, Boolean(parsedPrediction)),
        expectedTransaction: null,
        labelStatus: "UNLABELED",
        labelNote: "",
      };

      const key = sampleKey(row);
      const existing = existingByKey.get(key);
      if (existing) {
        row.expectedTransaction = existing.expectedTransaction ?? null;
        row.labelStatus = existing.labelStatus ?? (typeof existing.expectedTransaction === "boolean" ? "LABELED" : "UNLABELED");
        row.labelNote = existing.labelNote ?? "";
      }

      if (!rowsByInstitution.has(statement.institution)) {
        rowsByInstitution.set(statement.institution, new Map());
      }
      const institutionRows = rowsByInstitution.get(statement.institution);
      if (!institutionRows.has(key)) {
        institutionRows.set(key, row);
      }
    }
  }

  const sampledRows = [];
  for (const [institution, mapRows] of [...rowsByInstitution.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const rows = [...mapRows.values()].sort((a, b) => b.readability - a.readability);
    const chosen = sampleInstitutionRows(rows, options.samplePerInstitution);
    sampledRows.push(...chosen);
    // eslint-disable-next-line no-console
    console.log(`${institution}: sampled=${chosen.length} sourceRows=${rows.length}`);
  }

  sampledRows.sort((a, b) => {
    const inst = `${a.institution}`.localeCompare(`${b.institution}`);
    if (inst !== 0) {
      return inst;
    }
    return `${a.fileName}`.localeCompare(`${b.fileName}`);
  });

  await mkdir(path.dirname(existingPath), { recursive: true });
  await writeFile(
    existingPath,
    JSON.stringify(
      {
        generatedAt: toIsoNow(),
        mode: "collect",
        source: {
          dbPath,
          tenantId: options.tenantId,
          year: options.year,
          maxPerInstitution: options.maxPerInstitution,
          samplePerInstitution: options.samplePerInstitution,
          selectedStatements: selectedStatements.map((item) => ({
            id: item.id,
            institution: item.institution,
            fileName: item.fileName,
          })),
        },
        samples: sampledRows,
      },
      null,
      2,
    ),
    "utf8",
  );

  const labeledCount = sampledRows.filter((row) => typeof row.expectedTransaction === "boolean").length;
  // eslint-disable-next-line no-console
  console.log(`Samples written: ${existingPath}`);
  // eslint-disable-next-line no-console
  console.log(`Total samples: ${sampledRows.length} | Labeled: ${labeledCount} | Unlabeled: ${sampledRows.length - labeledCount}`);
}

function evaluateStats(rows) {
  const stats = { tp: 0, fp: 0, tn: 0, fn: 0 };
  for (const row of rows) {
    const predicted = Boolean(
      parseTransactionLineByInstitution({
        line: row.line,
        statementYear: row.statementYear ?? 2024,
        institution: row.institution,
      }),
    );
    const expected = row.expectedTransaction;
    if (predicted && expected) stats.tp += 1;
    if (predicted && !expected) stats.fp += 1;
    if (!predicted && !expected) stats.tn += 1;
    if (!predicted && expected) stats.fn += 1;
  }
  return stats;
}

function precision(stats) {
  const denom = stats.tp + stats.fp;
  return denom === 0 ? 1 : stats.tp / denom;
}

function recall(stats) {
  const denom = stats.tp + stats.fn;
  return denom === 0 ? 1 : stats.tp / denom;
}

async function runScore({ workspaceRoot, options }) {
  const samplesPath = path.resolve(workspaceRoot, options.output ?? DEFAULT_SAMPLES_PATH);
  const payload = JSON.parse(await readFile(samplesPath, "utf8"));
  const rows = Array.isArray(payload) ? payload : payload.samples ?? [];
  const labeledRows = rows.filter((row) => typeof row.expectedTransaction === "boolean");
  if (labeledRows.length === 0) {
    // eslint-disable-next-line no-console
    console.log(`No labeled samples found in ${samplesPath}.`);
    return;
  }

  const byInstitution = new Map();
  for (const row of labeledRows) {
    if (!byInstitution.has(row.institution)) {
      byInstitution.set(row.institution, []);
    }
    byInstitution.get(row.institution).push(row);
  }

  // eslint-disable-next-line no-console
  console.log(`Labeled sample rows: ${labeledRows.length}`);
  for (const [institution, rowsForInstitution] of [...byInstitution.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const stats = evaluateStats(rowsForInstitution);
    // eslint-disable-next-line no-console
    console.log(
      `${institution}: precision=${precision(stats).toFixed(3)} recall=${recall(stats).toFixed(3)} tp=${stats.tp} fp=${stats.fp} fn=${stats.fn} tn=${stats.tn}`,
    );
  }
}

async function main() {
  const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dbPath = path.resolve(workspaceRoot, "data", "db.json");
  const options = parseArgs(process.argv.slice(2));

  if (options.command === "collect") {
    await runCollect({ workspaceRoot, dbPath, options });
    return;
  }
  if (options.command === "score") {
    await runScore({ workspaceRoot, options });
    return;
  }
  await runScorecard({ workspaceRoot, dbPath, options });
}

try {
  await main();
} catch (error) {
  // eslint-disable-next-line no-console
  console.error("parser-real-data-harness failed:", error);
  process.exitCode = 1;
}
