-- qimen_records: 奇门遁甲起局历史记录表（D1，与 palm_records 同库不同表）
-- 记录每次成功排盘的起局要素与盘面关键结论；chart_summary 存 LLM 上下文骨架 JSON，便于复盘与后续复用。

CREATE TABLE IF NOT EXISTS qimen_records (
    id             TEXT PRIMARY KEY,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    solar_date     TEXT NOT NULL,
    time_index     INTEGER NOT NULL,
    day_ganzhi     TEXT DEFAULT '',
    time_ganzhi    TEXT DEFAULT '',
    ju_label       TEXT DEFAULT '',
    zhifu_desc     TEXT DEFAULT '',
    zhishi_desc    TEXT DEFAULT '',
    question_type  TEXT DEFAULT '',
    question_goal  TEXT DEFAULT '',
    patterns       TEXT DEFAULT '',
    chart_summary  TEXT DEFAULT ''
);

-- 常用检索：按时间倒序
CREATE INDEX IF NOT EXISTS idx_qimen_records_time ON qimen_records (created_at DESC);
