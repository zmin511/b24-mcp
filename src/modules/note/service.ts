import type { BitrixRestClient } from "../../bitrix/http/client.js";

export class BitrixNoteService {
  constructor(private readonly client: BitrixRestClient) {}

  collectionList(pagination?: Record<string, unknown>) {
    return this.client.callV3("note.collection.list", pagination ? { pagination } : {});
  }

  collectionGet(id: number, select?: string[]) {
    return this.client.callV3("note.collection.get", {
      id,
      ...(select ? { select } : {})
    });
  }

  documentTreeList(collectionId: number) {
    return this.client.callV3("note.document.tree.list", { collectionId });
  }

  documentGet(id: number, select?: string[]) {
    return this.client.callV3("note.document.get", {
      id,
      ...(select ? { select } : {})
    });
  }

  async documentGetSafe(
    id: number,
    options: {
      includeMarkdown?: boolean;
      markdownLimit?: number;
      select?: string[];
    } = {}
  ) {
    const includeMarkdown = options.includeMarkdown === true;
    const markdownLimit = Math.max(0, Math.min(options.markdownLimit ?? 12000, 100000));

    const select = options.select ?? (
      includeMarkdown
        ? ["id", "collectionId", "parentId", "title", "markdown", "position", "createdBy", "updatedBy", "createdAt", "updatedAt"]
        : ["id", "collectionId", "parentId", "title", "position", "createdBy", "updatedBy", "createdAt", "updatedAt"]
    );

    const res = await this.documentGet(id, select);
    const item = (res as any)?.result?.item;

    if (item && typeof item.markdown === "string") {
      const markdown = item.markdown;
      item.markdownLength = markdown.length;

      if (markdown.length > markdownLimit) {
        item.markdownPreview = markdown.slice(0, markdownLimit);
        item.markdownTruncated = true;
        delete item.markdown;
      } else {
        item.markdownTruncated = false;
      }
    }

    return res;
  }

  documentSearchList(query: string, pagination?: Record<string, unknown>) {
    return this.client.callV3("note.document.search.list", {
      query,
      ...(pagination ? { pagination } : {})
    });
  }

  documentCreate(params: {
    collectionId: number;
    parentId?: number;
    title: string;
    markdown: string;
    position?: number;
  }) {
    return this.client.callV3("note.document.add", { fields: params });
  }

  documentUpdate(params: {
    id: number;
    title?: string;
    markdown?: string;
    parentId?: number | null;
    position?: number;
  }) {
    const { id, ...fields } = params;
    return this.client.callV3("note.document.update", { id, fields });
  }

  documentDelete(id: number) {
    return this.client.callV3("note.document.delete", { id });
  }

}
