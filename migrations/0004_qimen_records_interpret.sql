-- qimen_records 补录解盘内容（第 16 轮）：
-- 起局历史原只存排盘信息（0003），本迁移为同一记录回填解盘（AI 解读）全文与其完成时间。
-- 解盘由 /api/qimen-interpret 完成：排盘响应返回 record_id，前端解盘时回传，
-- 服务端解盘成功后 best-effort UPDATE 本记录（未回传时不新增记录，AI 查询日志仍兜底存全文）。

ALTER TABLE qimen_records ADD COLUMN interpret_text TEXT DEFAULT '';
ALTER TABLE qimen_records ADD COLUMN interpreted_at TIMESTAMP DEFAULT NULL;
