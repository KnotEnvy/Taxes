import { readFile } from "node:fs/promises";
import path from "node:path";
import { extractTextCandidatesFromPdfBuffer } from "./pdf-text-extractor.mjs";
import { resolveParserAdapter } from "./institution-adapters.mjs";

const BASE_NOISE_WORDS = [
  "previous balance",
  "new balance",
  "ending balance",
  "beginning balance",
  "credit limit",
  "minimum payment",
  "available credit",
  "account number",
  "payment due",
  "finance charge",
  "interest charged",
  "total fees",
  "activity summary",
];

const MONTHS = Object.freeze({
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
});

const DATE_PATTERNS = [
  /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/,
  /\b(\d{1,2})\/(\d{1,2})\b/,
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s*(\d{2,4})?\b/i,
];

const AMOUNT_PATTERN = /(?:\(\$?\d{1,3}(?:,\d{3})*\.\d{2}\)|-?\$?\d{1,3}(?:,\d{3})*\.\d{2})/g;

function normalizeLine(line) {
  return line.replace(/\s+/g, " ").trim();
}

function buildNoiseWords(adapter) {
  const words = new Set(BASE_NOISE_WORDS);
  for (const phrase of adapter?.noiseWords ?? []) {
    words.add(phrase.toLowerCase());
  }
  return words;
}

function looksLikeNoise(line, noiseWords) {
  const lower = line.toLowerCase();
  for (const phrase of noiseWords) {
    if (lower.includes(phrase)) {
      return true;
    }
  }
  return false;
}

function parseAmount(rawAmount) {
  let clean = rawAmount.replaceAll("$", "").replaceAll(",", "").trim();
  let negative = false;
  if (clean.startsWith("(") && clean.endsWith(")")) {
    negative = true;
    clean = clean.slice(1, -1);
  }
  if (clean.startsWith("-")) {
    negative = true;
    clean = clean.slice(1);
  }
  const value = Number.parseFloat(clean);
  if (!Number.isFinite(value)) {
    return null;
  }
  return negative ? -value : value;
}

function toIsoDate({ month, day, year }, fallbackYear) {
  const safeYear = year ?? fallbackYear;
  if (!safeYear || !month || !day) {
    return null;
  }
  const mm = `${month}`.padStart(2, "0");
  const dd = `${day}`.padStart(2, "0");
  const yyyy = safeYear < 100 ? safeYear + 2000 : safeYear;
  return `${yyyy}-${mm}-${dd}`;
}

function parseDateToken(line, statementYear) {
  for (const pattern of DATE_PATTERNS) {
    const match = line.match(pattern);
    if (!match) {
      continue;
    }

    if (pattern === DATE_PATTERNS[0]) {
      const month = Number.parseInt(match[1], 10);
      const day = Number.parseInt(match[2], 10);
      const year = Number.parseInt(match[3], 10);
      return { token: match[0], value: toIsoDate({ month, day, year }, statementYear) };
    }

    if (pattern === DATE_PATTERNS[1]) {
      const month = Number.parseInt(match[1], 10);
      const day = Number.parseInt(match[2], 10);
      return { token: match[0], value: toIsoDate({ month, day, year: null }, statementYear) };
    }

    const month = MONTHS[match[1].slice(0, 3).toLowerCase()];
    const day = Number.parseInt(match[2], 10);
    const year = match[3] ? Number.parseInt(match[3], 10) : null;
    return { token: match[0], value: toIsoDate({ month, day, year }, statementYear) };
  }

  return null;
}

function parseTransactionLineFromNormalized(normalized, statementYear) {
  if (normalized.length < 8) {
    return null;
  }

  const amounts = normalized.match(AMOUNT_PATTERN);
  if (!amounts || amounts.length === 0) {
    return null;
  }

  const amountToken = amounts[amounts.length - 1];
  const amount = parseAmount(amountToken);
  if (amount === null) {
    return null;
  }

  const parsedDate = parseDateToken(normalized, statementYear);
  if (!parsedDate?.value) {
    return null;
  }

  const description = normalized
    .replace(parsedDate.token, " ")
    .replace(amountToken, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (description.length < 3) {
    return null;
  }

  return {
    postedDate: parsedDate.value,
    amount,
    description,
    rawLine: normalized,
  };
}

function lineLooksLikeTransactionCandidate(line, statementYear, noiseWords) {
  const normalized = normalizeLine(line);
  if (normalized.length < 8 || looksLikeNoise(normalized, noiseWords)) {
    return false;
  }

  const amounts = normalized.match(AMOUNT_PATTERN);
  if (!amounts || amounts.length === 0) {
    return false;
  }

  const parsedDate = parseDateToken(normalized, statementYear);
  return Boolean(parsedDate?.value);
}

export function computeParserConfidence({ parsedTransactions, candidateLines }) {
  if (candidateLines <= 0) {
    return parsedTransactions > 0 ? 1 : 0;
  }
  const ratio = parsedTransactions / candidateLines;
  const clamped = Math.max(0, Math.min(1, ratio));
  return Number.parseFloat(clamped.toFixed(4));
}

function uniqueTransactions(transactions) {
  const seen = new Set();
  const out = [];
  for (const tx of transactions) {
    const key = `${tx.postedDate}|${tx.amount.toFixed(2)}|${tx.description.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(tx);
  }
  return out;
}

function inferYearFromPath(fullPath) {
  const parts = fullPath.replaceAll("\\", "/").split("/");
  for (const part of parts) {
    if (/^20\d{2}$/.test(part)) {
      return Number.parseInt(part, 10);
    }
  }
  for (const part of parts) {
    const maybe = part.match(/20\d{2}/);
    if (maybe) {
      return Number.parseInt(maybe[0], 10);
    }
  }
  return null;
}

function monthNameToNumber(name) {
  return MONTHS[name.slice(0, 3).toLowerCase()] ?? null;
}

export function inferInstitutionFromPath(fullPath) {
  const lower = fullPath.toLowerCase();
  if (lower.includes("amex")) return "AMEX";
  if (lower.includes("bluevine")) return "BLUEVINE";
  if (lower.includes("cap1") || lower.includes("capital")) return "CAPITAL_ONE";
  if (lower.includes("cashapp")) return "CASH_APP";
  if (lower.includes("discover")) return "DISCOVER";
  if (lower.includes("spacecoast")) return "SPACE_COAST";
  return "UNKNOWN";
}

export function inferAccountLabel(fullPath) {
  const parts = fullPath.replaceAll("\\", "/").split("/");
  const bluevinePart = parts.find((part) => /\d{4}$/.test(part) && part.includes(" "));
  if (bluevinePart) {
    return bluevinePart.trim();
  }
  const parent = parts.at(-2);
  return parent ?? "default";
}

export function inferStatementPeriod(filePath) {
  const fileName = path.basename(filePath);
  const pathYear = inferYearFromPath(filePath);

  const isoMatch = fileName.match(/^(\d{4})-(\d{2})-(\d{2})\.pdf$/i);
  if (isoMatch) {
    return {
      year: Number.parseInt(isoMatch[1], 10),
      month: Number.parseInt(isoMatch[2], 10),
      day: Number.parseInt(isoMatch[3], 10),
    };
  }

  const bluevineMatch = fileName.match(/^statement_(\d{4})_(\d{1,2})\.pdf$/i);
  if (bluevineMatch) {
    return {
      year: Number.parseInt(bluevineMatch[1], 10),
      month: Number.parseInt(bluevineMatch[2], 10),
      day: null,
    };
  }

  const capOneMatch = fileName.match(/^statement_(\d{2})(\d{4})_\d+\.pdf$/i);
  if (capOneMatch) {
    return {
      year: Number.parseInt(capOneMatch[2], 10),
      month: Number.parseInt(capOneMatch[1], 10),
      day: null,
    };
  }

  const discoverMatch = fileName.match(/^discover-accountactivity-(\d{4})(\d{2})(\d{2})\.pdf$/i);
  if (discoverMatch) {
    return {
      year: Number.parseInt(discoverMatch[1], 10),
      month: Number.parseInt(discoverMatch[2], 10),
      day: Number.parseInt(discoverMatch[3], 10),
    };
  }

  const spaceCoastMatch = fileName.match(/^space(\d{2})(\d{2})\.pdf$/i);
  if (spaceCoastMatch) {
    return {
      year: 2000 + Number.parseInt(spaceCoastMatch[2], 10),
      month: Number.parseInt(spaceCoastMatch[1], 10),
      day: null,
    };
  }

  const cashAppMatch = fileName.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)-statement\.pdf$/i);
  if (cashAppMatch) {
    return {
      year: pathYear,
      month: monthNameToNumber(cashAppMatch[1]),
      day: null,
    };
  }

  return {
    year: pathYear,
    month: null,
    day: null,
  };
}

export function detectFolderYearMismatch(rootPath, filePath, statementYear) {
  const rootMatch = rootPath.replaceAll("\\", "/").match(/\/(20\d{2})(?:\/|$)/);
  if (!rootMatch || !statementYear) {
    return false;
  }
  const folderYear = Number.parseInt(rootMatch[1], 10);
  return folderYear !== statementYear && filePath.replaceAll("\\", "/").startsWith(rootPath.replaceAll("\\", "/"));
}

export async function parseStatementPdf({ filePath, statementYear, institution }) {
  const adapter = resolveParserAdapter(institution);
  const noiseWords = buildNoiseWords(adapter);
  const bytes = await readFile(filePath);
  const lines = extractTextCandidatesFromPdfBuffer(bytes, 7000);
  let droppedNoiseLines = 0;
  let candidateLines = 0;
  const transactions = [];

  for (const line of lines) {
    const normalized = normalizeLine(line);
    if (normalized.length < 8) {
      continue;
    }
    if (looksLikeNoise(normalized, noiseWords)) {
      droppedNoiseLines += 1;
      continue;
    }
    if (lineLooksLikeTransactionCandidate(normalized, statementYear, noiseWords)) {
      candidateLines += 1;
    }
    const tx = parseTransactionLineFromNormalized(normalized, statementYear);
    if (tx) {
      transactions.push(tx);
    }
  }

  const rawParsedTransactions = transactions.length;
  const deduped = uniqueTransactions(transactions).slice(0, 2000);
  const parserConfidence = computeParserConfidence({
    parsedTransactions: deduped.length,
    candidateLines,
  });
  return {
    transactions: deduped,
    diagnostics: {
      parseMethod: adapter.method,
      institutionAdapter: adapter.institution,
      fallbackToGeneric: adapter.fallbackToGeneric,
      textLines: lines.length,
      droppedNoiseLines,
      candidateLines,
      rawParsedTransactions,
      parsedTransactions: deduped.length,
      parserConfidence,
    },
  };
}
