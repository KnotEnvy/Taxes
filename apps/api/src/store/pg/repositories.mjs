function quoteIdent(identifier) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier.replaceAll('"', '""')}"`;
}

function coerceNumeric(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

class PgTableRepository {
  #table;
  #columns;
  #numericFields;
  #listSql;
  #upsertSql;

  constructor({ table, columns, numericFields = [] }) {
    this.#table = table;
    this.#columns = columns;
    this.#numericFields = new Set(numericFields);

    const selectCols = columns
      .map((col) => `${quoteIdent(col.db)} AS ${quoteIdent(col.domain)}`)
      .join(", ");
    this.#listSql = `SELECT ${selectCols} FROM ${quoteIdent(table)}`;

    const insertCols = columns.map((col) => quoteIdent(col.db)).join(", ");
    const valueTokens = columns
      .map((col, index) => {
        const cast = col.cast ? `::${col.cast}` : "";
        return `$${index + 1}${cast}`;
      })
      .join(", ");
    const updateSet = columns
      .filter((col) => col.domain !== "id")
      .map((col) => `${quoteIdent(col.db)} = EXCLUDED.${quoteIdent(col.db)}`)
      .join(", ");
    this.#upsertSql =
      `INSERT INTO ${quoteIdent(table)} (${insertCols}) VALUES (${valueTokens}) ` +
      `ON CONFLICT (${quoteIdent("id")}) DO UPDATE SET ${updateSet}`;
  }

  #serializeValue(column, row) {
    const raw = typeof column.valueFromRow === "function" ? column.valueFromRow(row) : row[column.domain];
    if (raw === undefined) {
      return null;
    }
    if (column.cast === "jsonb") {
      return raw === null ? null : JSON.stringify(raw);
    }
    return raw;
  }

  #deserializeRow(row) {
    const out = {};
    for (const column of this.#columns) {
      const value = row[column.domain];
      if (this.#numericFields.has(column.domain)) {
        out[column.domain] = coerceNumeric(value);
      } else {
        out[column.domain] = value ?? null;
      }
    }
    return out;
  }

  async list(client) {
    const result = await client.query(this.#listSql);
    return result.rows.map((row) => this.#deserializeRow(row));
  }

  async upsertRows(client, rows) {
    for (const row of rows) {
      const values = this.#columns.map((column) => this.#serializeValue(column, row));
      await client.query(this.#upsertSql, values);
    }
  }

  async deleteMissingRows(client, { currentRows, nextRows }) {
    const currentIds = new Set(currentRows.map((row) => row.id));
    const nextIds = new Set(nextRows.map((row) => row.id));
    const deleteIds = [];

    for (const id of currentIds) {
      if (!nextIds.has(id)) {
        deleteIds.push(id);
      }
    }

    if (deleteIds.length === 0) {
      return;
    }

    await client.query(
      `DELETE FROM ${quoteIdent(this.#table)} WHERE ${quoteIdent("id")} = ANY($1::text[])`,
      [deleteIds],
    );
  }
}

export const TABLE_ORDER_UPSERT = Object.freeze([
  "tenants",
  "businessEntityProfiles",
  "financialAccounts",
  "statements",
  "transactions",
  "reviewQueue",
  "auditEvents",
  "rules",
]);

export const TABLE_ORDER_DELETE = Object.freeze([
  "rules",
  "auditEvents",
  "reviewQueue",
  "transactions",
  "statements",
  "financialAccounts",
  "businessEntityProfiles",
  "tenants",
]);

export function createPgRepositories() {
  return {
    tenants: new PgTableRepository({
      table: "tenants",
      columns: [
        { domain: "id", db: "id" },
        { domain: "name", db: "name" },
        { domain: "createdAt", db: "created_at" },
      ],
    }),
    businessEntityProfiles: new PgTableRepository({
      table: "business_entity_profiles",
      columns: [
        { domain: "id", db: "id" },
        { domain: "tenantId", db: "tenant_id" },
        { domain: "entityType", db: "entity_type" },
        { domain: "effectiveFrom", db: "effective_from" },
        { domain: "effectiveTo", db: "effective_to" },
        { domain: "createdAt", db: "created_at" },
      ],
    }),
    financialAccounts: new PgTableRepository({
      table: "financial_accounts",
      columns: [
        { domain: "id", db: "id" },
        { domain: "tenantId", db: "tenant_id" },
        { domain: "institution", db: "institution" },
        { domain: "accountLabel", db: "account_label" },
        { domain: "last4", db: "last4" },
        { domain: "createdAt", db: "created_at" },
      ],
    }),
    statements: new PgTableRepository({
      table: "statements",
      columns: [
        { domain: "id", db: "id" },
        { domain: "tenantId", db: "tenant_id" },
        { domain: "financialAccountId", db: "financial_account_id" },
        { domain: "institution", db: "institution" },
        { domain: "accountLabel", db: "account_label" },
        { domain: "fileName", db: "file_name" },
        { domain: "storedPath", db: "stored_path" },
        { domain: "sourcePath", db: "source_path" },
        { domain: "checksum", db: "checksum" },
        { domain: "statementYear", db: "statement_year" },
        { domain: "statementMonth", db: "statement_month" },
        { domain: "statementDay", db: "statement_day" },
        { domain: "folderYearMismatch", db: "folder_year_mismatch" },
        { domain: "status", db: "status" },
        { domain: "parseDiagnostics", db: "parse_diagnostics", cast: "jsonb" },
        { domain: "error", db: "error" },
        { domain: "uploadedBy", db: "uploaded_by" },
        { domain: "createdAt", db: "created_at" },
        { domain: "processedAt", db: "processed_at" },
      ],
    }),
    transactions: new PgTableRepository({
      table: "transactions",
      columns: [
        { domain: "id", db: "id" },
        { domain: "tenantId", db: "tenant_id" },
        { domain: "statementId", db: "statement_id" },
        { domain: "financialAccountId", db: "financial_account_id" },
        { domain: "postedDate", db: "posted_date" },
        { domain: "amount", db: "amount" },
        { domain: "description", db: "description" },
        { domain: "rawLine", db: "raw_line" },
        { domain: "taxonomyId", db: "taxonomy_id" },
        { domain: "categoryCode", db: "category_code" },
        { domain: "confidence", db: "confidence" },
        { domain: "classificationMethod", db: "classification_method" },
        { domain: "reasonCodes", db: "reason_codes", cast: "jsonb" },
        { domain: "needsReview", db: "needs_review" },
        { domain: "createdAt", db: "created_at" },
        { domain: "updatedAt", db: "updated_at" },
      ],
      numericFields: ["amount", "confidence"],
    }),
    reviewQueue: new PgTableRepository({
      table: "review_queue_items",
      columns: [
        { domain: "id", db: "id" },
        { domain: "tenantId", db: "tenant_id" },
        { domain: "statementId", db: "statement_id" },
        { domain: "transactionId", db: "transaction_id" },
        { domain: "reason", db: "reason" },
        { domain: "detail", db: "detail" },
        { domain: "status", db: "status" },
        { domain: "createdAt", db: "created_at" },
        { domain: "resolvedAt", db: "resolved_at" },
        { domain: "resolutionNote", db: "resolution_note" },
      ],
    }),
    auditEvents: new PgTableRepository({
      table: "audit_events",
      columns: [
        { domain: "id", db: "id" },
        { domain: "tenantId", db: "tenant_id" },
        { domain: "action", db: "action" },
        { domain: "payload", db: "payload", cast: "jsonb" },
        { domain: "createdAt", db: "created_at" },
      ],
    }),
    rules: new PgTableRepository({
      table: "classification_rules",
      columns: [
        { domain: "id", db: "id" },
        { domain: "tenantId", db: "tenant_id" },
        { domain: "payload", db: "payload", cast: "jsonb", valueFromRow: (row) => row.payload ?? row },
        { domain: "createdAt", db: "created_at" },
      ],
    }),
  };
}
