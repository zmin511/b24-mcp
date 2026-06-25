import { z } from "zod";

const booleanFromEnv = z
  .union([z.literal("true"), z.literal("false")])
  .transform((v) => v === "true");

const envSchema = z.object({
  NODE_ENV: z.string().optional().default("development"),
  LOG_LEVEL: z.string().optional().default("info"),
  DATABASE_URL: z.string().min(1),
  APP_ENCRYPTION_KEY_BASE64: z.string().optional().default(""),
  BITRIX_DEFAULT_CONNECTION_ID: z.string().optional().default("default"),
  JOBS_ENABLED: booleanFromEnv.optional().default("true"),
  JOBS_POLL_INTERVAL_SEC: z.coerce.number().int().positive().optional().default(60),
  ALLOW_UNCONFIRMED_WRITES: booleanFromEnv.optional().default("false"),
  MCP_HTTP_ENABLED: booleanFromEnv.optional().default("true"),
  MCP_HTTP_HOST: z.string().optional().default("127.0.0.1"),
  MCP_HTTP_PORT: z.coerce.number().int().positive().optional().default(7010),
  MCP_AUTH_TOKEN: z.string().optional().default(""),
  BITRIX_OAUTH_PORTAL_URL: z.string().optional().default(""),
  BITRIX_OAUTH_CLIENT_ID: z.string().optional().default(""),
  BITRIX_OAUTH_CLIENT_SECRET: z.string().optional().default(""),
  BITRIX_OAUTH_REDIRECT_URI: z.string().optional().default("")
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(env);
}
