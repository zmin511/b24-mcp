import type { BitrixRestClient } from "../../bitrix/http/client.js";

export class BitrixImService {
  constructor(private readonly client: BitrixRestClient) {}

  recentList() {
    return this.client.call("im.recent.list", {});
  }

  dialogMessagesGet(dialogId: string, limit?: number) {
    const params: Record<string, unknown> = { dialog_id: dialogId };
    if (limit) params.limit = limit;
    return this.client.call("im.dialog.messages.get", params);
  }

  messageAdd(dialogId: string, message: string) {
    return this.client.call("im.message.add", {
      DIALOG_ID: dialogId,
      MESSAGE: message
    });
  }

  notifyPersonalAdd(userId: number, message: string) {
    return this.client.call("im.notify.personal.add", {
      USER_ID: userId,
      MESSAGE: message
    });
  }
}
