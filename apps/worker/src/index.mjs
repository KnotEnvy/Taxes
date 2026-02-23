import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "../../api/src/store/store-factory.mjs";
import { processPendingStatements } from "../../api/src/services/statement-processor.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "../../../");
const dbPath = process.env.TAXES_DB_PATH ?? path.join(workspaceRoot, "data", "db.json");
const storeBackend = (process.env.TAXES_STORE ?? "file").toLowerCase();
const databaseUrl = process.env.DATABASE_URL ?? null;
const dbSchema = process.env.TAXES_DB_SCHEMA ?? "public";

const runOnce = process.argv.includes("--once");
const intervalMs = Number.parseInt(process.env.WORKER_INTERVAL_MS ?? "5000", 10);

const store = createStore({
  fileDbPath: dbPath,
  postgresConnectionString: databaseUrl,
  postgresSchema: dbSchema,
});
await store.init();

let shouldRun = true;
process.on("SIGINT", async () => {
  shouldRun = false;
  await store.close();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  shouldRun = false;
  await store.close();
  process.exit(0);
});

async function tick() {
  const result = await processPendingStatements({ store, limit: 10 });
  // eslint-disable-next-line no-console
  console.log(
    `[worker] ${new Date().toISOString()} processed=${result.processedCount} requestedLimit=${result.requestedLimit}`,
  );
}

if (runOnce) {
  await tick();
  await store.close();
  process.exit(0);
}

// eslint-disable-next-line no-console
console.log(`[worker] watch mode started. store=${storeBackend} intervalMs=${intervalMs}`);
while (shouldRun) {
  await tick();
  await new Promise((resolve) => {
    setTimeout(resolve, intervalMs);
  });
}
