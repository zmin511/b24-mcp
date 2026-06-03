# Bitrix24 OAuth Self-Service Setup

This is the second connector mode: every employee authorizes in Bitrix24 as themselves, and MCP calls are performed through that employee's OAuth tokens.

## What to create in Bitrix24

Create a Bitrix24 local application.

Use these settings:

- Application type: server/local application with REST API access
- Redirect URI: `https://your-mcp-domain.example.com/oauth/bitrix/callback`
- Scopes: select every REST scope needed by the MCP tools you plan to expose
  - tasks
  - user
  - im
  - disk
  - landing
  - bizproc
  - crm, if legacy CRM tools are needed

After saving the app, Bitrix24 gives:

- `client_id`
- `client_secret`

Put them into `.env`:

```env
BITRIX_OAUTH_PORTAL_URL=https://your-portal.bitrix24.ru
BITRIX_OAUTH_CLIENT_ID=...
BITRIX_OAUTH_CLIENT_SECRET=...
BITRIX_OAUTH_REDIRECT_URI=https://your-mcp-domain.example.com/oauth/bitrix/callback
APP_ENCRYPTION_KEY_BASE64=...
```

`APP_ENCRYPTION_KEY_BASE64` must be a 32-byte base64 key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## User flow

1. Employee opens:
   `https://your-mcp-domain.example.com/oauth/bitrix/start`
2. Bitrix24 asks them to authorize the local application.
3. The MCP server receives the callback and stores encrypted Bitrix OAuth tokens.
4. The MCP server shows a one-time MCP token.
5. Employee configures the GPT MCP connector with:
   - MCP URL: `https://your-mcp-domain.example.com/mcp`
   - Authorization/API key: the one-time token shown after OAuth

## Important

- The MCP server never receives the user's Bitrix password.
- Bitrix login, 2FA, SSO, and password rules stay fully inside Bitrix24.
- Incoming webhooks still work for service users such as `service connector`.
- User MCP tokens cannot override `connection_id`; the server always uses the Bitrix connection linked to that token.

