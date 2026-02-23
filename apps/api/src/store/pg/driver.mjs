let cachedModule = null;

async function loadPgModule() {
  if (cachedModule) {
    return cachedModule;
  }
  try {
    cachedModule = await import("pg");
    return cachedModule;
  } catch (error) {
    throw new Error(
      "PostgreSQL store selected but `pg` is not installed. Install dependencies and retry. Original error: " +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}

export async function createPgPool({ connectionString, max = 10 }) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required when TAXES_STORE=postgres.");
  }

  const module = await loadPgModule();
  const Pool = module.Pool ?? module.default?.Pool;
  if (!Pool) {
    throw new Error("Unable to load Pool from `pg` package.");
  }

  return new Pool({
    connectionString,
    max,
  });
}
