import type { BitrixRestClient } from "../../bitrix/http/client.js";

export class BitrixBizprocService {
  constructor(private readonly client: BitrixRestClient) {}

  templateList(params: Record<string, unknown> = {}) {
    return this.client.call("bizproc.workflow.template.list", params);
  }

  start(params: { templateId: number; documentId: unknown; parameters?: Record<string, unknown> }) {
    return this.client.call("bizproc.workflow.start", {
      TEMPLATE_ID: params.templateId,
      DOCUMENT_ID: params.documentId,
      PARAMETERS: params.parameters ?? {}
    });
  }

  instances(params: Record<string, unknown> = {}) {
    return this.client.call("bizproc.workflow.instances", params);
  }

  kill(params: { workflowId: string }) {
    return this.client.call("bizproc.workflow.kill", { ID: params.workflowId });
  }

  templateUpdateIfSupported(params: { templateId: number; fields: Record<string, unknown> }) {
    return this.client.call("bizproc.workflow.template.update", { ID: params.templateId, FIELDS: params.fields });
  }
}

