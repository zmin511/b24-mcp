# Authentication Model

The server has two independent authorization layers:

1. MCP access token: authorizes a person or admin to call this MCP server.
2. Bitrix connection: decides which Bitrix24 user/robot is used for REST API calls.

## Recommended setup

### Robot connection

Create one Bitrix24 incoming webhook for the robot user, for example `R2D2`, and register it as:

```json
{
  "tool": "bitrix_connection_upsert",
  "args": {
    "confirm": true,
    "id": "r2d2",
    "portal_url": "https://your-portal.bitrix24.ru",
    "auth_type": "webhook",
    "webhook_url": "https://your-portal.bitrix24.ru/rest/123/robot-webhook/"
  }
}
```

Use this connection for service jobs, reports, background sync, or actions that should be explicitly performed by the robot.

### Personal connection

For each employee, create a Bitrix24 incoming webhook or OAuth connection under that employee account:

```json
{
  "tool": "bitrix_connection_upsert",
  "args": {
    "confirm": true,
    "id": "user-ivan",
    "portal_url": "https://your-portal.bitrix24.ru",
    "auth_type": "webhook",
    "webhook_url": "https://your-portal.bitrix24.ru/rest/456/user-webhook/"
  }
}
```

Then issue an MCP access token mapped to that Bitrix connection:

```json
{
  "tool": "bitrix_mcp_access_token_upsert",
  "args": {
    "confirm": true,
    "id": "ivan-gpt",
    "token": "long-random-token-given-to-ivan",
    "label": "Ivan GPT connector",
    "actor_name": "Ivan",
    "bitrix_connection_id": "user-ivan",
    "bitrix_user_id": 456
  }
}
```

The plaintext token is not stored. The database stores only `sha256(token)`.

## Runtime behavior

- Admin token: `MCP_AUTH_TOKEN` from `.env`; can manage connections and user MCP tokens.
- User token: row in `mcp_access_tokens`; all tool calls are forced to that token's `bitrix_connection_id`.
- A user token cannot override `connection_id` in tool arguments.
- Write tools still require `confirm=true` and are written to `audit_log`.

## Current limitation

Self-service OAuth login is not implemented yet. For now an admin creates the user's Bitrix connection and MCP access token. OAuth can be added later as a `/oauth/bitrix/start` and `/oauth/bitrix/callback` flow that creates the same records automatically.

