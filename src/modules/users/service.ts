import type { BitrixRestClient } from "../../bitrix/http/client.js";

export class BitrixUsersService {
  constructor(private readonly client: BitrixRestClient) {}

  search(params: { query: string; limit?: number }) {
    // Bitrix user.search: filter is implicit via "FIND" in many portals; we keep simple and pass "FIND".
    return this.client.call("user.search", { FIND: params.query, start: 0, limit: params.limit ?? 50 } as any);
  }
}

