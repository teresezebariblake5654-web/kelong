export type ProviderMetricBucket = {
  requests: number;
  successes: number;
  failures: number;
  retries: number;
  totalDurationMs: number;
};

export type LeadProviderMetricsSnapshot = {
  searxng: ProviderMetricBucket;
  firecrawl: ProviderMetricBucket;
  keelead: ProviderMetricBucket;
  llm: ProviderMetricBucket;
};

function emptyBucket(): ProviderMetricBucket {
  return { requests: 0, successes: 0, failures: 0, retries: 0, totalDurationMs: 0 };
}

export class LeadProviderMetricsCollector {
  private readonly buckets: LeadProviderMetricsSnapshot = {
    searxng: emptyBucket(),
    firecrawl: emptyBucket(),
    keelead: emptyBucket(),
    llm: emptyBucket(),
  };

  record(event: {
    provider: string;
    ok: boolean;
    retries: number;
    durationMs: number;
  }): void {
    const key = event.provider as keyof LeadProviderMetricsSnapshot;
    const bucket = this.buckets[key];
    if (!bucket) return;
    bucket.requests += 1;
    if (event.ok) bucket.successes += 1;
    else bucket.failures += 1;
    bucket.retries += event.retries;
    bucket.totalDurationMs += Math.max(0, event.durationMs);
  }

  snapshot(): LeadProviderMetricsSnapshot {
    return {
      searxng: { ...this.buckets.searxng },
      firecrawl: { ...this.buckets.firecrawl },
      keelead: { ...this.buckets.keelead },
      llm: { ...this.buckets.llm },
    };
  }
}
