import type { BitrixRestClient } from "../http/client.js";

export type BitrixCapabilities = {
  methods: Set<string>;
};

export async function detectCapabilities(client: BitrixRestClient): Promise<BitrixCapabilities> {
  try {
    const res = await client.call<string[]>("methods", {});
    const list = res.result ?? [];
    return { methods: new Set(list) };
  } catch {
    return { methods: new Set() };
  }
}

export function hasMethod(caps: BitrixCapabilities, method: string): boolean {
  if (caps.methods.size === 0) return true; // unknown -> assume available; fail at call-time
  return caps.methods.has(method);
}

