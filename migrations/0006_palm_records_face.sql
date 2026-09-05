-- migrations/0006_palm_records_face.sql
-- R18-5: 在 palm_records 中扩展 mode 列，将同一张表复用于"面相"记录
-- mode 取值: 'palm' (默认，兼容历史数据) | 'face'
-- face 模式下 hand_side 列填 'face' 作占位（无手侧概念）
-- 应用方式: wrangler d1 migrations apply QUERY_LOGS_DB
-- 应用时机: R18-5 部署后由用户手动执行；应用前 face 模式写入会静默失败（设计如此）

ALTER TABLE palm_records ADD COLUMN mode TEXT NOT NULL DEFAULT 'palm';
CREATE INDEX IF NOT EXISTS idx_palm_records_mode_user_time ON palm_records (mode, user_id, created_at DESC);