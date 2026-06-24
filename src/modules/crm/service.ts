import type { BitrixRestClient } from "../../bitrix/http/client.js";

export class BitrixCrmService {
  constructor(private readonly client: BitrixRestClient) {}

  dealAdd(fields: Record<string, unknown>, params: Record<string, unknown> = { REGISTER_SONET_EVENT: "Y" }) {
    return this.client.call("crm.deal.add", { fields, params });
  }

  dealGet(id: number) {
    return this.client.call("crm.deal.get", { id });
  }

  dealFields() {
    return this.client.call("crm.deal.fields", {});
  }

  dealCategoryList(params: Record<string, unknown> = {}) {
    return this.client.call("crm.dealcategory.list", params);
  }

  dealStageList(entityId: string) {
    return this.client.call("crm.status.list", { filter: { ENTITY_ID: entityId } });
  }
}
