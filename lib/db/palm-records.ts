export interface PalmRecord {
  id: string;
  userId: string;
  imageKey: string;
  imageUrl: string;
  extractedFeatures: string;
  reportContent: string;
}

type D1Env = {
  QUERY_LOGS_DB: {
    prepare(sql: string): {
      bind(...args: unknown[]): {
        run(): Promise<unknown>;
        all<T>(): Promise<{ results: T[] }>;
      };
    };
  };
};

/** 写入一条手相测算记录（R2 key 已在调用前存入）。绑定名沿用仓库既有 QUERY_LOGS_DB。 */
export async function insertPalmRecord(env: unknown, record: PalmRecord): Promise<void> {
  const e = env as D1Env;
  await e.QUERY_LOGS_DB.prepare(
    `INSERT INTO palm_records (id, user_id, image_key, image_url, extracted_features, report_content)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(record.id, record.userId, record.imageKey, record.imageUrl, record.extractedFeatures, record.reportContent)
    .run();
}