import crypto from "node:crypto";
import { AppError } from "../../common/errors.js";

export type BitrixOAuthTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires?: number;
  expires_in?: number;
  domain?: string;
  client_endpoint?: string;
  member_id?: string;
  user_id?: number;
  scope?: string;
  status?: string;
};

export function randomUrlToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function buildBitrixAuthorizeUrl(params: {
  portalUrl: string;
  clientId: string;
  redirectUri: string;
  state: string;
}) {
  const portal = params.portalUrl.replace(/\/+$/, "");
  const url = new URL(`${portal}/oauth/authorize/`);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  return url.toString();
}

export async function exchangeBitrixOAuthCode(params: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri?: string;
}): Promise<BitrixOAuthTokenResponse> {
  const url = new URL("https://oauth.bitrix.info/oauth/token/");
  url.searchParams.set("grant_type", "authorization_code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("client_secret", params.clientSecret);
  url.searchParams.set("code", params.code);
  if (params.redirectUri) url.searchParams.set("redirect_uri", params.redirectUri);

  return fetchBitrixOAuthToken(url);
}

export async function refreshBitrixOAuthToken(params: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<BitrixOAuthTokenResponse> {
  const url = new URL("https://oauth.bitrix.info/oauth/token/");
  url.searchParams.set("grant_type", "refresh_token");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("client_secret", params.clientSecret);
  url.searchParams.set("refresh_token", params.refreshToken);

  return fetchBitrixOAuthToken(url);
}

function tokenExpiresAt(token: BitrixOAuthTokenResponse): Date | null {
  if (typeof token.expires === "number") return new Date(token.expires * 1000);
  if (typeof token.expires_in === "number") return new Date(Date.now() + token.expires_in * 1000);
  return null;
}

export function getBitrixTokenExpiresAt(token: BitrixOAuthTokenResponse): Date | null {
  return tokenExpiresAt(token);
}

export function getPortalUrlFromOAuth(token: BitrixOAuthTokenResponse, fallbackPortalUrl: string): string {
  if (token.client_endpoint) {
    try {
      const endpoint = new URL(token.client_endpoint);
      return endpoint.origin;
    } catch {
      // Continue to other sources.
    }
  }
  if (token.domain) return `https://${token.domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return fallbackPortalUrl;
}

async function fetchBitrixOAuthToken(url: URL): Promise<BitrixOAuthTokenResponse> {
  const res = await fetch(url);
  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new AppError("Bitrix OAuth returned non-JSON response", "BITRIX_OAUTH_BAD_RESPONSE", {
      status: res.status,
      details: { text: text.slice(0, 200) }
    });
  }

  if (!res.ok || json.error) {
    throw new AppError("Bitrix OAuth token request failed", "BITRIX_OAUTH_ERROR", {
      status: res.status,
      details: json
    });
  }

  return json as BitrixOAuthTokenResponse;
}

