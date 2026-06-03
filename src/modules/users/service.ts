import type { BitrixRestClient } from "../../bitrix/http/client.js";

export type BitrixUserSearchParams = {
  query?: string;
  limit?: number;
  start?: number;
  active?: boolean;
};

export class BitrixUsersService {
  constructor(private readonly client: BitrixRestClient) {}

  search(params: BitrixUserSearchParams = {}) {
    const payload: Record<string, any> = {
      start: params.start ?? 0,
      limit: params.limit ?? 50
    };

    if (params.query && params.query.trim()) {
      payload.FIND = params.query.trim();
    }

    if (typeof params.active === "boolean") {
      payload.ACTIVE = params.active ? "Y" : "N";
    }

    return this.client.call("user.search", payload as any);
  }

  async listAll(params: Omit<BitrixUserSearchParams, "start"> & { maxUsers?: number } = {}) {
    const limit = params.limit ?? 50;
    const maxUsers = params.maxUsers ?? 5000;

    let start = 0;
    const users: any[] = [];
    let page = 0;
    let lastResponse: any = null;

    while (users.length < maxUsers) {
      const res: any = await this.search({
        query: params.query,
        limit,
        start,
        active: params.active
      });

      lastResponse = res;

      const batch =
        Array.isArray(res?.result)
          ? res.result
          : Array.isArray(res?.result?.users)
            ? res.result.users
            : [];

      users.push(...batch);

      const next = res?.next ?? res?.result?.next;

      if (next === undefined || next === null || next === "" || batch.length === 0) {
        break;
      }

      start = Number(next);
      page += 1;

      if (!Number.isFinite(start) || page > 300) {
        break;
      }
    }

    return {
      totalLoaded: users.length,
      totalReported: lastResponse?.total ?? lastResponse?.result?.total ?? null,
      users: users.slice(0, maxUsers),
      truncated: users.length >= maxUsers
    };
  }
}
