import { ConfirmRequiredError } from "../common/errors.js";

export function requireConfirm(tool: string, input: any, allowUnconfirmedWrites: boolean) {
  const confirm = !!input?.confirm;
  if (!confirm && !allowUnconfirmedWrites) throw new ConfirmRequiredError(tool);
}

export function redactSecrets(input: any): any {
  if (input == null) return input;
  try {
    const seen = new WeakSet<object>();
    const walk = (v: any): any => {
      if (v == null) return v;
      if (typeof v !== "object") return v;
      if (seen.has(v)) return "[circular]";
      seen.add(v);
      if (Array.isArray(v)) return v.map(walk);
      const out: Record<string, any> = {};
      for (const [k, val] of Object.entries(v)) {
        const key = k.toLowerCase();
        if (key.includes("token") || key.includes("webhook") || key.includes("secret") || key.includes("password")) {
          out[k] = "***redacted***";
        } else {
          out[k] = walk(val);
        }
      }
      return out;
    };
    return walk(input);
  } catch {
    return { redacted: true };
  }
}
