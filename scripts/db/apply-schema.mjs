import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function safeSchema(schemaName) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(schemaName);
}

async function loadPgModule() {
  try {
    return await import("pg");
  } catch (error) {
    throw new Error(
      "Cannot apply schema because `pg` is not installed. Install dependencies first. Original error: " +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const schemaName = process.env.TAXES_DB_SCHEMA ?? "public";

  if (!connectionString) {
    throw new Error("DATABASE_URL is required.");
  }
  if (!safeSchema(schemaName)) {
    throw new Error(`Invalid TAXES_DB_SCHEMA: ${schemaName}`);
  }

  const module = await loadPgModule();
  const Pool = module.Pool ?? module.default?.Pool;
  if (!Pool) {
    throw new Error("Unable to load Pool from `pg` package.");
  }

  const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const schemaPath = path.join(scriptRoot, "infra", "postgres", "schema.sql");
  const template = await readFile(schemaPath, "utf8");
  const sql = template.replaceAll("__SCHEMA__", schemaName);

  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    await client.query(sql);
    // eslint-disable-next-line no-console
    console.log(`Schema applied successfully to schema "${schemaName}".`);
  } finally {
    client.release();
    await pool.end();
  }
}

try {
  await main();
} catch (error) {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
