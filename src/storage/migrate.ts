import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPool } from "./db.js";
import { loadConfig } from "../common/config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function ensureMigrationsTable(pool: ReturnType<typeof createPool>) {
  await pool.query(`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    );
  `);
}

async function listMigrationFiles(migrationsDir: string) {
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.match(/^\\d+_.+\\.sql$/))
    .map((e) => e.name)
    .sort();
}

export async function runMigrations() {
  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL);
  try {
    await ensureMigrationsTable(pool);
    const migrationsDir = path.resolve(__dirname, "../../migrations");
    const files = await listMigrationFiles(migrationsDir);

    for (const file of files) {
      const id = file;
      const already = await pool.query("select 1 from schema_migrations where id = $1", [id]);
      if (already.rowCount && already.rowCount > 0) continue;

      const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
      await pool.query("begin");
      try {
        await pool.query(sql);
        await pool.query("insert into schema_migrations(id) values ($1)", [id]);
        await pool.query("commit");
      } catch (e) {
        await pool.query("rollback");
        throw e;
      }
    }
  } finally {
    await pool.end();
  }
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
const self = path.resolve(fileURLToPath(import.meta.url));
if (invoked && invoked === self) {
  runMigrations().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  });
}
