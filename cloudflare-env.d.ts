interface CloudflareEnv {
  AI_RATE_LIMITER: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
  QUERY_LOGS_DB?: unknown;
  PALM_IMAGES_BUCKET: R2Bucket;
  HAND_KNOWLEDGE_INDEX: VectorizeIndex;
  AI: Ai;
}
