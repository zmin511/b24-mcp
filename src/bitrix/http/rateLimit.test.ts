import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rateLimit.js";

describe("RateLimiter", () => {
  it("serializes scheduled calls", async () => {
    const rl = new RateLimiter({ requestsPerSecond: 1000 });
    const order: number[] = [];
    await Promise.all([
      rl.schedule(async () => order.push(1)),
      rl.schedule(async () => order.push(2)),
      rl.schedule(async () => order.push(3))
    ]);
    expect(order).toEqual([1, 2, 3]);
  });
});

