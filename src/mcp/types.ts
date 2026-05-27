export type ToolResult = {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
    | { type: "audio"; data: string; mimeType: string }
    | { type: "resource_link"; name: string; uri: string }
    | { type: "resource"; resource: Record<string, unknown> }
  >;
  isError?: boolean;
};

export function jsonResult(json: unknown): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(json, null, 2)
      }
    ]
  };
}
