export class RateLimiter {
  private readonly minIntervalMs: number;
  private nextAllowedAt = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(opts: { requestsPerSecond: number }) {
    this.minIntervalMs = Math.ceil(1000 / Math.max(1, opts.requestsPerSecond));
  }

  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = async () => {
      const now = Date.now();
      const wait = Math.max(0, this.nextAllowedAt - now);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.nextAllowedAt = Date.now() + this.minIntervalMs;
      return fn();
    };

    const pending = this.chain.then(run, run);
    this.chain = pending.then(
      () => undefined,
      () => undefined
    );
    return pending;
  }
}

