-- palm_records: 手相测算记录表（D1）
-- 与会话记录 QUERY_LOGS_DB 解耦，用独立表；若希望同库，库名在 wrangler.jsonc 中指向 ziwei-doushu-logs 并删除下方 IF NOT EXISTS 之前的部分即可。

CREATE TABLE IF NOT EXISTS palm_records (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL,
    image_key         TEXT NOT NULL,
    image_url         TEXT NOT NULL,
    extracted_features TEXT DEFAULT '',
    report_content    TEXT DEFAULT '',
    hand_side         TEXT DEFAULT 'right',
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 常用检索索引：按用户、时间倒序
CREATE INDEX IF NOT EXISTS idx_palm_records_user_time ON palm_records (user_id, created_at DESC);