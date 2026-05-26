export type ToolResult = {
  content: Array<
    | { type: "text"; text: string }
    | { type: "json"; json: unknown }
  >;
  isError?: boolean;
};

export function jsonResult(json: unknown): ToolResult {
  return { content: [{ type: "json", json }] };
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

