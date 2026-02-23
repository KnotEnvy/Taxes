import { FileStore } from "./file-store.mjs";
import { PostgresStore } from "./pg-store.mjs";

export function createStore({
  fileDbPath,
  postgresConnectionString,
  postgresSchema,
}) {
  const backend = (process.env.TAXES_STORE ?? "file").toLowerCase();
  if (backend === "postgres") {
    return new PostgresStore({
      connectionString: postgresConnectionString,
      schema: postgresSchema ?? "public",
    });
  }
  return new FileStore(fileDbPath);
}
