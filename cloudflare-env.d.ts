interface CloudflareEnv {
  AI_RATE_LIMITER: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
}
