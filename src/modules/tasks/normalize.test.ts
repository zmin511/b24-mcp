import { describe, expect, it } from "vitest";
import { normalizeChatMessages, normalizeLegacyComments, normalizeTask } from "./normalize.js";

describe("normalizeTask", () => {
  it("maps dates and status", () => {
    const n = normalizeTask({
      ID: "123",
      TITLE: "t",
      STATUS: "5",
      CREATED_DATE: "2026-01-01T00:00:00Z",
      CLOSED_DATE: "2026-01-02T00:00:00Z"
    });
    expect(n.taskId).toBe(123);
    expect(n.status).toBe("COMPLETED");
    expect(n.createdDate).toBe("2026-01-01T00:00:00Z");
    expect(n.closedDate).toBe("2026-01-02T00:00:00Z");
    expect(n.isCompleted).toBe(true);
  });
});

describe("normalizeChatMessages", () => {
  it("normalizes im.dialog.messages.get payload", () => {
    const msgs = normalizeChatMessages(1, {
      result: {
        messages: [{ id: 10, author_id: 2, date_create: "2026-01-01T00:00:00Z", text: "hi" }]
      }
    });
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.source).toBe("chat");
    expect(msgs[0]?.messageId).toBe("10");
    expect(msgs[0]?.authorId).toBe(2);
    expect(msgs[0]?.text).toBe("hi");
  });
});

describe("normalizeLegacyComments", () => {
  it("normalizes task.commentitem.getlist payload", () => {
    const msgs = normalizeLegacyComments(1, {
      result: [{ ID: "99", AUTHOR_ID: "7", POST_DATE: "2026-01-01T00:00:00Z", POST_MESSAGE: "legacy" }]
    });
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.source).toBe("legacy");
    expect(msgs[0]?.messageId).toBe("99");
    expect(msgs[0]?.authorId).toBe(7);
    expect(msgs[0]?.text).toBe("legacy");
  });
});

