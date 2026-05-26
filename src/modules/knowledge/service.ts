import type { BitrixRestClient } from "../../bitrix/http/client.js";

export class BitrixKnowledgeService {
  constructor(private readonly client: BitrixRestClient) {}

  kbSiteList() {
    return this.client.call("landing.site.getList", { params: { filter: { TYPE: "KNOWLEDGE" } } });
  }

  kbSiteCreate(params: { title: string; code?: string }) {
    return this.client.call("landing.site.add", {
      fields: { TITLE: params.title, CODE: params.code, TYPE: "KNOWLEDGE" }
    });
  }

  kbPageList(siteId: number) {
    return this.client.call("landing.landing.getList", { params: { select: ["ID", "TITLE", "CODE"], filter: { SITE_ID: siteId } } });
  }

  kbPageCreate(params: { siteId: number; title: string; code?: string }) {
    return this.client.call("landing.landing.add", {
      fields: { SITE_ID: params.siteId, TITLE: params.title, CODE: params.code }
    });
  }

  kbPageUpdate(params: { pageId: number; title?: string; code?: string }) {
    return this.client.call("landing.landing.update", { id: params.pageId, fields: { TITLE: params.title, CODE: params.code } });
  }

  kbPageAddBlock(params: { pageId: number; code: string; content: Record<string, unknown> }) {
    return this.client.call("landing.block.add", { lid: params.pageId, fields: { CODE: params.code, CONTENT: params.content } });
  }
}

