CREATE TABLE IF NOT EXISTS ai_query_logs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  session_id TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT,
  chart_summary TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'error')),
  error_message TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  country TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_query_logs_created_at
  ON ai_query_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_query_logs_status_created_at
  ON ai_query_logs(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_query_logs_session_id
  ON ai_query_logs(session_id);
