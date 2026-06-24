import type { BitrixRestClient } from "../../bitrix/http/client.js";

export class BitrixKnowledgeService {
  constructor(private readonly client: BitrixRestClient) {}

  kbSiteList() {
    return this.client.call("landing.site.getList", { params: { filter: { TYPE: "KNOWLEDGE" } } });
  }

  kbSiteListRaw() {
    return this.client.call("landing.site.getList", { params: {} });
  }

  kbPageListFull(siteId: number) {
    return this.client.call("landing.landing.getList", {
      params: {
        select: [
          "ID",
          "SITE_ID",
          "TITLE",
          "CODE",
          "ACTIVE",
          "DELETED",
          "DATE_CREATE",
          "DATE_MODIFY",
          "CREATED_BY_ID",
          "MODIFIED_BY_ID"
        ],
        filter: { SITE_ID: siteId }
      }
    });
  }

  kbPageFindById(pageId: number) {
    return this.client.call("landing.landing.getList", {
      params: {
        select: [
          "ID",
          "SITE_ID",
          "TITLE",
          "CODE",
          "ACTIVE",
          "DELETED",
          "DATE_CREATE",
          "DATE_MODIFY",
          "CREATED_BY_ID",
          "MODIFIED_BY_ID"
        ],
        filter: { ID: pageId }
      }
    });
  }

  async kbFindByUrl(url: string) {
    const parsed = this.parseKnowledgeUrl(url);

    const sites = await this.client.call<any>("landing.site.getList", { params: { filter: { TYPE: "KNOWLEDGE" } } });

    let pageById: any = null;
    if (parsed.pageId) {
      try {
        pageById = await this.kbPageFindById(parsed.pageId);
      } catch (err: any) {
        pageById = {
          error: {
            code: err?.code,
            message: err?.message,
            details: err?.details
          }
        };
      }
    }

    let pagesByWikiIdAsSiteId: any = null;
    if (parsed.wikiId) {
      try {
        pagesByWikiIdAsSiteId = await this.kbPageListFull(parsed.wikiId);
      } catch (err: any) {
        pagesByWikiIdAsSiteId = {
          error: {
            code: err?.code,
            message: err?.message,
            details: err?.details
          }
        };
      }
    }

    const siteRows = Array.isArray(sites?.result) ? sites.result : [];
    const slug = parsed.knowledgeSlug ? `/${parsed.knowledgeSlug}/` : undefined;

    const candidateSites = siteRows.filter((site: any) => {
      const siteId = Number(site?.ID);
      const landingIndexId = Number(site?.LANDING_ID_INDEX);
      const code = String(site?.CODE ?? "");
      const title = String(site?.TITLE ?? "");

      return (
        (parsed.wikiId && siteId === parsed.wikiId) ||
        (parsed.pageId && landingIndexId === parsed.pageId) ||
        (slug && code === slug) ||
        (slug && code.includes(slug)) ||
        (parsed.knowledgeSlug && title.toLowerCase().includes(parsed.knowledgeSlug.toLowerCase()))
      );
    });

    return {
      parsed,
      candidateSites,
      pageById,
      pagesByWikiIdAsSiteId,
      notes: [
        "For /kb/wiki/<id>/, Bitrix UI id may not equal landing SITE_ID.",
        "For /kb/wiki/<wikiId>/view/<pageId>/, pageId is likely a landing ID.",
        "Use candidateSites[].ID as site_id for page create/list if it matches the target knowledge base."
      ]
    };
  }

  private parseKnowledgeUrl(url: string) {
    let pathname = url;

    try {
      pathname = new URL(url).pathname;
    } catch {
      // Accept plain paths as well.
    }

    const wikiMatch = pathname.match(/\/kb\/wiki\/(\d+)(?:\/view\/(\d+))?/);
    const knowledgeMatch = pathname.match(/\/knowledge\/([^/]+)\/?/);

    return {
      input: url,
      pathname,
      wikiId: wikiMatch?.[1] ? Number(wikiMatch[1]) : undefined,
      pageId: wikiMatch?.[2] ? Number(wikiMatch[2]) : undefined,
      knowledgeSlug: knowledgeMatch?.[1]
    };
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

