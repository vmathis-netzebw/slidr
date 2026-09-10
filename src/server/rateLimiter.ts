/**
 * Token-Bucket Rate-Limiter.
 * Keys werden nur flüchtig im RAM gehalten und regelmäßig entfernt.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** true = erlaubt, false = blockiert. */
  tryConsume(key: string, cost = 1): boolean {
    const timestamp = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, updatedAt: timestamp };

    const elapsedSeconds = Math.max(0, (timestamp - bucket.updatedAt) / 1000);
    const tokens = Math.min(this.capacity, bucket.tokens + elapsedSeconds * this.refillPerSecond);

    if (tokens < cost) {
      this.buckets.set(key, { tokens, updatedAt: timestamp });
      return false;
    }

    this.buckets.set(key, { tokens: tokens - cost, updatedAt: timestamp });
    return true;
  }

  release(key: string): void {
    this.buckets.delete(key);
  }

  /** Entfernt Buckets, die lange nicht genutzt wurden (wieder voll aufgefüllt wären). */
  prune(maxIdleMs = 10 * 60 * 1000): void {
    const cutoff = this.now() - maxIdleMs;
    for (const [key, bucket] of this.buckets) {
      if (bucket.updatedAt < cutoff) this.buckets.delete(key);
    }
  }
}
