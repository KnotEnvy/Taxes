import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { STATEMENT_STATUS } from "../domain/constants.mjs";
import { newId } from "../utils/id.mjs";
import { nowIso } from "../utils/time.mjs";
import {
  detectFolderYearMismatch,
  inferAccountLabel,
  inferInstitutionFromPath,
  inferStatementPeriod,
} from "./parser/statement-parser.mjs";

async function walkPdfFiles(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkPdfFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && fullPath.toLowerCase().endsWith(".pdf")) {
      files.push(fullPath);
    }
  }

  return files;
}

function checksum(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function extractLast4(accountLabel) {
  const match = accountLabel.match(/(\d{4})$/);
  return match ? match[1] : null;
}

function ensureFinancialAccount({ db, tenantId, institution, accountLabel }) {
  const existing = db.financialAccounts.find(
    (item) =>
      item.tenantId === tenantId &&
      item.institution === institution &&
      item.accountLabel.toLowerCase() === accountLabel.toLowerCase(),
  );
  if (existing) {
    return existing;
  }
  const account = {
    id: newId("acct"),
    tenantId,
    institution,
    accountLabel,
    last4: extractLast4(accountLabel),
    createdAt: nowIso(),
  };
  db.financialAccounts.push(account);
  return account;
}

async function registerStatementFromFile({
  db,
  tenantId,
  filePath,
  sourceRootPath,
  storageRootPath,
  uploadedBy,
}) {
  const bytes = await readFile(filePath);
  const fileChecksum = checksum(bytes);
  const dup = db.statements.find((statement) => statement.tenantId === tenantId && statement.checksum === fileChecksum);
  if (dup) {
    return { created: false, statement: dup, reason: "duplicate_checksum" };
  }

  const institution = inferInstitutionFromPath(filePath);
  const accountLabel = inferAccountLabel(filePath);
  const period = inferStatementPeriod(filePath);
  const folderYearMismatch = detectFolderYearMismatch(sourceRootPath, filePath, period.year);
  const account = ensureFinancialAccount({ db, tenantId, institution, accountLabel });

  const statementId = newId("stmt");
  const fileName = path.basename(filePath);
  const tenantStorageDir = path.join(storageRootPath, tenantId);
  await mkdir(tenantStorageDir, { recursive: true });
  const storedPath = path.join(tenantStorageDir, `${statementId}.pdf`);
  await copyFile(filePath, storedPath);

  const statement = {
    id: statementId,
    tenantId,
    financialAccountId: account.id,
    institution,
    accountLabel,
    fileName,
    storedPath,
    sourcePath: filePath,
    checksum: fileChecksum,
    statementYear: period.year,
    statementMonth: period.month,
    statementDay: period.day,
    folderYearMismatch,
    status: folderYearMismatch ? STATEMENT_STATUS.NEEDS_REVIEW : STATEMENT_STATUS.QUEUED,
    parseDiagnostics: null,
    error: null,
    uploadedBy: uploadedBy ?? "system",
    createdAt: nowIso(),
    processedAt: null,
  };
  db.statements.push(statement);
  return { created: true, statement };
}

export async function scanAndRegisterStatements({
  store,
  tenantId,
  sourceRootPath,
  storageRootPath,
  uploadedBy,
}) {
  const files = await walkPdfFiles(sourceRootPath);
  const createdStatements = [];
  const duplicates = [];

  await store.withWrite(async (db) => {
    for (const filePath of files) {
      const result = await registerStatementFromFile({
        db,
        tenantId,
        filePath,
        sourceRootPath,
        storageRootPath,
        uploadedBy,
      });
      if (result.created) {
        createdStatements.push(result.statement);
      } else {
        duplicates.push({ filePath, reason: result.reason });
      }
    }
    return db;
  });

  return {
    discovered: files.length,
    created: createdStatements.length,
    duplicates: duplicates.length,
    duplicateDetails: duplicates,
    createdStatements,
  };
}

export async function registerUploadedStatement({
  store,
  tenantId,
  fileName,
  contentBase64,
  storageRootPath,
  uploadedBy,
  institutionHint,
  accountLabelHint,
}) {
  const bytes = Buffer.from(contentBase64, "base64");
  if (bytes.length === 0) {
    throw new Error("Uploaded file body is empty.");
  }

  const tempName = `${newId("upload")}_${fileName || "statement.pdf"}`;
  const tempDir = path.join(storageRootPath, "_uploads");
  await mkdir(tempDir, { recursive: true });
  const tempPath = path.join(tempDir, tempName);
  await writeFile(tempPath, bytes);

  let createdStatement = null;
  await store.withWrite(async (db) => {
    const fileChecksum = checksum(bytes);
    const dup = db.statements.find((statement) => statement.tenantId === tenantId && statement.checksum === fileChecksum);
    if (dup) {
      createdStatement = dup;
      return db;
    }

    const institution = institutionHint || inferInstitutionFromPath(fileName ?? tempPath);
    const accountLabel = accountLabelHint || inferAccountLabel(fileName ?? tempPath);
    const period = inferStatementPeriod(fileName ?? tempPath);
    const account = ensureFinancialAccount({ db, tenantId, institution, accountLabel });

    const statementId = newId("stmt");
    const tenantStorageDir = path.join(storageRootPath, tenantId);
    await mkdir(tenantStorageDir, { recursive: true });
    const storedPath = path.join(tenantStorageDir, `${statementId}.pdf`);
    await copyFile(tempPath, storedPath);

    createdStatement = {
      id: statementId,
      tenantId,
      financialAccountId: account.id,
      institution,
      accountLabel,
      fileName: fileName || path.basename(tempPath),
      storedPath,
      sourcePath: "upload",
      checksum: fileChecksum,
      statementYear: period.year,
      statementMonth: period.month,
      statementDay: period.day,
      folderYearMismatch: false,
      status: STATEMENT_STATUS.QUEUED,
      parseDiagnostics: null,
      error: null,
      uploadedBy: uploadedBy ?? "api",
      createdAt: nowIso(),
      processedAt: null,
    };
    db.statements.push(createdStatement);
    return db;
  });

  return createdStatement;
}
