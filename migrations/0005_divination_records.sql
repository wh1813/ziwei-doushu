-- migrations/0005_divination_records.sql
-- 多个起局模块的独立 D1 表（R18 起）
-- 设计：每模块一张表 + interpret_text/interpreted_at 列；面相/手相继续走 R2 存储 + ai_query_logs 元数据，不在此处建表
-- 应用方式：wrangler d1 migrations apply QUERY_LOGS_DB
-- 应用时机：R18-1 部署后由用户手动执行；应用前所有新模块的 recordId 落库静默失败（设计如此）

-- 六爻（周易）：问事、起卦方式、手动爻或时间起卦、本卦/变卦、用神/世应/动爻
CREATE TABLE IF NOT EXISTS sixyao_records (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  session_id TEXT NOT NULL,
  question TEXT,
  question_goal TEXT,
  ben_gua TEXT,                  -- 本卦（如"乾为天"）
  bian_gua TEXT,                 -- 变卦
  yao_count INTEGER,             -- 爻数（6）
  method TEXT,                   -- 起卦方式：manual | time | number | mengshi
  day_ganzhi TEXT,               -- 起卦日干支
  time_ganzhi TEXT,              -- 起卦时干支
  yong_shen TEXT,                -- 用神（如"妻财午火"）
  shi_yao_index INTEGER,         -- 世爻位置 1-6
  ying_yao_index INTEGER,        -- 应爻位置 1-6
  dong_yao_indices TEXT,         -- JSON 数组，动爻位置
  patterns TEXT,                 -- JSON 数组，命中格局
  chart_payload TEXT NOT NULL,   -- 完整排盘 JSON（LLM 解读的唯一输入）
  interpret_text TEXT DEFAULT '',
  interpreted_at TIMESTAMP DEFAULT NULL,
  duration_ms INTEGER,
  country TEXT
);
CREATE INDEX IF NOT EXISTS idx_sixyao_session ON sixyao_records(session_id, created_at DESC);

-- 大六壬：天盘/地盘/四课/三传/发用/贼克比用涉害等课体
CREATE TABLE IF NOT EXISTS daliuren_records (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  session_id TEXT NOT NULL,
  question TEXT,
  question_goal TEXT,
  day_ganzhi TEXT,
  time_ganzhi TEXT,
  month_general TEXT,            -- 月将（如"子"）
  ju_type TEXT,                  -- 课体类型：贼克 | 比用 | 涉害 | 遥克 | 昴星 | 别责 | 八专 | 伏吟 | 反吟 | 三光 | 三阳
  fa_yong_gan TEXT,              -- 发用天干
  fa_yong_zhi TEXT,              -- 发用地支
  san_chuan TEXT,                -- JSON 数组，三传（[初传, 中传, 末传]）
  si_ke TEXT,                    -- JSON 数组，四课
  patterns TEXT,                 -- JSON 数组
  chart_payload TEXT NOT NULL,
  interpret_text TEXT DEFAULT '',
  interpreted_at TIMESTAMP DEFAULT NULL,
  duration_ms INTEGER,
  country TEXT
);
CREATE INDEX IF NOT EXISTS idx_daliuren_session ON daliuren_records(session_id, created_at DESC);

-- 小六壬：6 宫位 + 时辰 + 大安/留连/速喜/赤口/小吉/空亡
CREATE TABLE IF NOT EXISTS xiaoliuren_records (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  session_id TEXT NOT NULL,
  question TEXT,
  question_goal TEXT,
  time_ganzhi TEXT,              -- 起卦时辰
  start_palace TEXT,             -- 起卦宫位（如"大安"）
  status TEXT,                   -- 状态：大安/留连/速喜/赤口/小吉/空亡
  chart_payload TEXT NOT NULL,   -- 6 宫位完整 JSON
  interpret_text TEXT DEFAULT '',
  interpreted_at TIMESTAMP DEFAULT NULL,
  duration_ms INTEGER,
  country TEXT
);
CREATE INDEX IF NOT EXISTS idx_xiaoliuren_session ON xiaoliuren_records(session_id, created_at DESC);

-- 紫微大限/流年（既有的紫微排盘数据已经在 ziwei_records 沿用 qimen_records 模式；本表是 R18-6 扩充时新增的大限/流年专属）
CREATE TABLE IF NOT EXISTS ziwei_fortune_records (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  session_id TEXT NOT NULL,
  question TEXT,
  question_goal TEXT,
  base_chart_id TEXT,            -- 关联的紫微排盘 recordId
  period TEXT,                   -- decade | year | month
  start_year INTEGER,
  end_year INTEGER,
  focus TEXT,                    -- 事业 | 感情 | 健康 | 财运
  chart_payload TEXT NOT NULL,
  interpret_text TEXT DEFAULT '',
  interpreted_at TIMESTAMP DEFAULT NULL,
  duration_ms INTEGER,
  country TEXT
);
CREATE INDEX IF NOT EXISTS idx_ziwei_fortune_session ON ziwei_fortune_records(session_id, created_at DESC);

-- 关系合盘：主记录
CREATE TABLE IF NOT EXISTS relationship_records (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  session_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL,  -- 感情 | 合作 | 亲缘
  module TEXT NOT NULL,             -- 主用模块：qimen | ziwei | sixyao | daliuren
  chart_payload TEXT NOT NULL,
  interpret_text TEXT DEFAULT '',
  interpreted_at TIMESTAMP DEFAULT NULL,
  duration_ms INTEGER,
  country TEXT
);
CREATE INDEX IF NOT EXISTS idx_relationship_session ON relationship_records(session_id, created_at DESC);

-- 关系合盘：参与者子表（双人或多人）
CREATE TABLE IF NOT EXISTS relationship_participants (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  role TEXT NOT NULL,               -- subject | partner | other
  display_name TEXT,
  birth_date TEXT,
  birth_time_index INTEGER,
  gender TEXT,                      -- 男 | 女 | 不指定
  bazi_json TEXT,                   -- 缓存八字 JSON
  FOREIGN KEY (record_id) REFERENCES relationship_records(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_participants_record ON relationship_participants(record_id);

-- 运势中心：跨模块综合报告（不起新盘，聚合已有子记录）
CREATE TABLE IF NOT EXISTS fortune_records (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  session_id TEXT NOT NULL,
  period TEXT NOT NULL,             -- month | season | year
  focus TEXT NOT NULL,              -- 事业 | 感情 | 健康 | 财运 | 综合
  source_record_ids TEXT NOT NULL,  -- JSON 数组：子记录 id（来自 sixyao_records / qimen_records / ziwei_fortune_records / ...）
  chart_payload TEXT NOT NULL,      -- 聚合后的子模块关键点
  interpret_text TEXT DEFAULT '',
  interpreted_at TIMESTAMP DEFAULT NULL,
  duration_ms INTEGER,
  country TEXT
);
CREATE INDEX IF NOT EXISTS idx_fortune_session ON fortune_records(session_id, created_at DESC);
