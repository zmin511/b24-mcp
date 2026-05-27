import { AppError } from "../../common/errors.js";
import type { Logger } from "../../common/logger.js";
import type { BitrixAuth } from "../auth/auth.js";
import type { BitrixRestResponse } from "./types.js";
import { RateLimiter } from "./rateLimit.js";

export type BitrixClientOptions = {
  logger: Logger;
  auth: BitrixAuth;
  requestsPerSecond?: number;
  retries?: number;
};

function normalizeBaseUrl(url: string) {
  return url.endsWith("/") ? url : `${url}/`;
}

function appendFormValue(body: URLSearchParams, key: string, value: unknown) {
  if (value === undefined || value === null) return;

  if (Array.isArray(value)) {
    value.forEach((item, index) => appendFormValue(body, `${key}[${index}]`, item));
    return;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    for (const [childKey, childValue] of entries) {
      appendFormValue(body, `${key}[${childKey}]`, childValue);
    }
    return;
  }

  body.set(key, String(value));
}

export class BitrixRestClient {
  private readonly logger: Logger;
  private readonly auth: BitrixAuth;
  private readonly limiter: RateLimiter;
  private readonly retries: number;

  constructor(opts: BitrixClientOptions) {
    this.logger = opts.logger;
    this.auth = opts.auth;
    this.limiter = new RateLimiter({ requestsPerSecond: opts.requestsPerSecond ?? 2 });
    this.retries = opts.retries ?? 3;
  }

  private buildUrl(method: string): string {
    if (this.auth.type === "webhook") {
      const base = normalizeBaseUrl(this.auth.webhookUrl);
      return `${base}${method}.json`;
    }
    const base = normalizeBaseUrl(this.auth.portalUrl);
    return `${base}rest/${method}.json`;
  }

  async call<T>(method: string, params: Record<string, unknown> = {}): Promise<BitrixRestResponse<T>> {
    const url = this.buildUrl(method);

    const doFetch = async (): Promise<BitrixRestResponse<T>> => {
      const body = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        appendFormValue(body, key, value);
      }

      const headers: Record<string, string> = {
        "content-type": "application/x-www-form-urlencoded"
      };
      if (this.auth.type === "oauth") headers.authorization = `Bearer ${this.auth.accessToken}`;

      const res = await fetch(url, { method: "POST", body, headers });
      const text = await res.text();
      let json: unknown;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        throw new AppError(`Bitrix REST returned non-JSON for ${method}`, "BITRIX_BAD_RESPONSE", {
          status: res.status,
          details: { text: text.slice(0, 200) }
        });
      }

      if (!res.ok) {
        throw new AppError(`Bitrix REST HTTP ${res.status} for ${method}`, "BITRIX_HTTP", {
          status: res.status,
          details: json
        });
      }

      const br = json as BitrixRestResponse<T>;
      if (br.error) {
        throw new AppError(`Bitrix REST error for ${method}: ${br.error}`, "BITRIX_ERROR", { details: br });
      }
      return br;
    };

    return this.limiter.schedule(async () => {
      let lastErr: unknown;
      for (let attempt = 0; attempt <= this.retries; attempt++) {
        try {
          return await doFetch();
        } catch (e: any) {
          lastErr = e;
          const status = e?.status ?? e?.statusCode ?? e?.cause?.status;
          const retryable =
            status === 429 || (typeof status === "number" && status >= 500) || (e?.code && String(e.code).includes("ECONN"));

          if (!retryable || attempt === this.retries) break;
          const backoff = 250 * Math.pow(2, attempt);
          this.logger.warn({ method, attempt, backoff }, "bitrix_call_retry");
          await new Promise((r) => setTimeout(r, backoff));
        }
      }
      throw lastErr;
    });
  }

  async callMultipart<T>(
    method: string,
    params: Record<string, unknown>,
    files: Record<string, { buffer: Buffer; filename: string; contentType?: string }>
  ): Promise<BitrixRestResponse<T>> {
    const url = this.buildUrl(method);

    const doFetch = async (): Promise<BitrixRestResponse<T>> => {
      const form = new FormData();
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined) continue;
        form.set(key, typeof value === "string" ? value : JSON.stringify(value));
      }
      for (const [field, f] of Object.entries(files)) {
        const part = new Uint8Array(f.buffer);
        const file = new File([part], f.filename, f.contentType ? { type: f.contentType } : undefined);
        form.set(field, file);
      }

      const headers: Record<string, string> = {};
      if (this.auth.type === "oauth") headers.authorization = `Bearer ${this.auth.accessToken}`;

      const res = await fetch(url, { method: "POST", body: form, headers });
      const text = await res.text();
      let json: unknown;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        throw new AppError(`Bitrix REST returned non-JSON for ${method}`, "BITRIX_BAD_RESPONSE", {
          status: res.status,
          details: { text: text.slice(0, 200) }
        });
      }

      if (!res.ok) {
        throw new AppError(`Bitrix REST HTTP ${res.status} for ${method}`, "BITRIX_HTTP", {
          status: res.status,
          details: json
        });
      }

      const br = json as BitrixRestResponse<T>;
      if (br.error) {
        throw new AppError(`Bitrix REST error for ${method}: ${br.error}`, "BITRIX_ERROR", { details: br });
      }
      return br;
    };

    return this.limiter.schedule(async () => {
      let lastErr: unknown;
      for (let attempt = 0; attempt <= this.retries; attempt++) {
        try {
          return await doFetch();
        } catch (e: any) {
          lastErr = e;
          const status = e?.status ?? e?.statusCode ?? e?.cause?.status;
          const retryable =
            status === 429 || (typeof status === "number" && status >= 500) || (e?.code && String(e.code).includes("ECONN"));

          if (!retryable || attempt === this.retries) break;
          const backoff = 250 * Math.pow(2, attempt);
          this.logger.warn({ method, attempt, backoff }, "bitrix_call_retry");
          await new Promise((r) => setTimeout(r, backoff));
        }
      }
      throw lastErr;
    });
  }

  async callAllPages<TItem>(method: string, params: Record<string, unknown> = {}): Promise<TItem[]> {
    const items: TItem[] = [];
    let start: number | undefined = undefined;
    for (let page = 0; page < 1000; page++) {
      const res: any = await this.call<any>(method, {
        ...params,
        ...(start !== undefined ? { start } : {})
      });
      const list = (res.result as any)?.items ?? (res.result as any) ?? [];
      if (Array.isArray(list)) items.push(...(list as TItem[]));
      const next: unknown = (res as any).next;
      if (typeof next !== "number") break;
      start = next;
    }
    return items;
  }
}
