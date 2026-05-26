import pino from "pino";

export function createLogger(level: string) {
  return pino({
    level,
    redact: {
      paths: [
        "*.webhook_url",
        "*.access_token",
        "*.refresh_token",
        "*.oauth_access_token_enc",
        "*.oauth_refresh_token_enc",
        "webhook_url",
        "access_token",
        "refresh_token"
      ],
      remove: true
    }
  });
}

export type Logger = ReturnType<typeof createLogger>;

