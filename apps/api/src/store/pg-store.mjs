import { createPgPool } from "./pg/driver.mjs";
import { createPgRepositories, TABLE_ORDER_DELETE, TABLE_ORDER_UPSERT } from "./pg/repositories.mjs";
import { EMPTY_DB } from "./empty-db.mjs";

function isSafeSchema(schemaName) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(schemaName);
}

export class PostgresStore {
  #connectionString;
  #schema;
  #pool;
  #repositories;
  #writeQueue;

  constructor({ connectionString, schema = "public" } = {}) {
    if (!isSafeSchema(schema)) {
      throw new Error(`Invalid schema name: ${schema}`);
    }
    this.#connectionString = connectionString;
    this.#schema = schema;
    this.#pool = null;
    this.#repositories = null;
    this.#writeQueue = Promise.resolve();
  }

  async init() {
    this.#pool = await createPgPool({
      connectionString: this.#connectionString,
    });
    this.#repositories = createPgRepositories();

    const client = await this.#pool.connect();
    try {
      await this.#setSearchPath(client);
      const health = await client.query("SELECT 1 AS ok");
      if (health.rows[0]?.ok !== 1) {
        throw new Error("Failed to connect to PostgreSQL.");
      }

      const schemaCheck = await client.query("SELECT to_regclass($1) AS regclass", [`${this.#schema}.tenants`]);
      if (!schemaCheck.rows[0]?.regclass) {
        throw new Error(
          `PostgreSQL schema is not initialized for schema '${this.#schema}'. Run scripts/db/apply-schema.mjs first.`,
        );
      }
    } finally {
      client.release();
    }
  }

  async #setSearchPath(client) {
    if (this.#schema === "public") {
      return;
    }
    await client.query(`SET search_path TO "${this.#schema}"`);
  }

  async #readSnapshot(client) {
    const snapshot = structuredClone(EMPTY_DB);
    for (const tableKey of TABLE_ORDER_UPSERT) {
      snapshot[tableKey] = await this.#repositories[tableKey].list(client);
    }
    return snapshot;
  }

  async read() {
    const client = await this.#pool.connect();
    try {
      await this.#setSearchPath(client);
      return await this.#readSnapshot(client);
    } finally {
      client.release();
    }
  }

  async #syncSnapshot(client, current, next) {
    for (const tableKey of TABLE_ORDER_UPSERT) {
      await this.#repositories[tableKey].upsertRows(client, next[tableKey]);
    }
    for (const tableKey of TABLE_ORDER_DELETE) {
      await this.#repositories[tableKey].deleteMissingRows(client, {
        currentRows: current[tableKey],
        nextRows: next[tableKey],
      });
    }
  }

  async #withWriteInternal(mutator) {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await this.#setSearchPath(client);
      await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");

      const current = await this.#readSnapshot(client);
      const clone = structuredClone(current);
      const maybeNext = await mutator(clone);
      const next = maybeNext ?? clone;
      await this.#syncSnapshot(client, current, next);
      await client.query("COMMIT");
      return next;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async withWrite(mutator) {
    this.#writeQueue = this.#writeQueue.catch(() => undefined).then(() => this.#withWriteInternal(mutator));
    return this.#writeQueue;
  }

  async close() {
    if (this.#pool) {
      await this.#pool.end();
      this.#pool = null;
    }
  }
}
