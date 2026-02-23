import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRouter } from "./router.mjs";
import { createStore } from "./store/store-factory.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "../../../");

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "127.0.0.1";
const STORE_BACKEND = (process.env.TAXES_STORE ?? "file").toLowerCase();
const DATA_DB_PATH = process.env.TAXES_DB_PATH ?? path.join(workspaceRoot, "data", "db.json");
const DATABASE_URL = process.env.DATABASE_URL ?? null;
const DB_SCHEMA = process.env.TAXES_DB_SCHEMA ?? "public";
const STORAGE_PATH = process.env.TAXES_STORAGE_PATH ?? path.join(workspaceRoot, "storage", "statements");
const DEFAULT_SCAN_PATH = process.env.TAXES_DEFAULT_SCAN_PATH ?? path.join(workspaceRoot, "2024");
const WEB_ROOT_PATH = process.env.TAXES_WEB_ROOT ?? path.join(workspaceRoot, "apps", "web");

const store = createStore({
  fileDbPath: DATA_DB_PATH,
  postgresConnectionString: DATABASE_URL,
  postgresSchema: DB_SCHEMA,
});
await store.init();

const route = createRouter({
  store,
  storageRootPath: STORAGE_PATH,
  defaultScanPath: DEFAULT_SCAN_PATH,
  webRootPath: WEB_ROOT_PATH,
});

const server = http.createServer(route);

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(
    `Tax API listening on http://${HOST}:${PORT}\n` +
      `store=${STORE_BACKEND}\n` +
      `db=${STORE_BACKEND === "file" ? DATA_DB_PATH : "[postgres configured via DATABASE_URL]"}\n` +
      `dbSchema=${DB_SCHEMA}\n` +
      `storage=${STORAGE_PATH}\n` +
      `scanDefault=${DEFAULT_SCAN_PATH}`,
  );
});

async function shutdown() {
  server.close(async () => {
    await store.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
