import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { EMPTY_DB } from "./empty-db.mjs";

export class FileStore {
  #dbPath;
  #writeQueue;

  constructor(dbPath) {
    this.#dbPath = dbPath;
    this.#writeQueue = Promise.resolve();
  }

  async init() {
    await mkdir(path.dirname(this.#dbPath), { recursive: true });
    try {
      await readFile(this.#dbPath, "utf8");
    } catch {
      await writeFile(this.#dbPath, JSON.stringify(EMPTY_DB, null, 2), "utf8");
    }
  }

  async read() {
    const raw = await readFile(this.#dbPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(EMPTY_DB),
      ...parsed,
    };
  }

  async write(db) {
    const tmpPath = `${this.#dbPath}.tmp`;
    const body = `${JSON.stringify(db, null, 2)}\n`;
    await writeFile(tmpPath, body, "utf8");
    await rename(tmpPath, this.#dbPath);
  }

  async withWrite(mutator) {
    this.#writeQueue = this.#writeQueue.catch(() => undefined).then(async () => {
      const current = await this.read();
      const clone = structuredClone(current);
      const maybeNext = await mutator(clone);
      const next = maybeNext ?? clone;
      await this.write(next);
      return next;
    });

    return this.#writeQueue;
  }

  async close() {}
}
