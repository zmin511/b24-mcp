import { loadConfig } from "./common/config.js";
import { createLogger } from "./common/logger.js";
import { createPool } from "./storage/db.js";
import { createMcpServer } from "./mcp/server.js";
import { runMigrations } from "./storage/migrate.js";

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const pool = createPool(config.DATABASE_URL);

  // Best-effort migrate on startup for MVP.
  await runMigrations();

  const { start } = createMcpServer({ config, logger, pool });
  await start();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});

