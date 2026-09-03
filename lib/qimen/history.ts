import { getQueryLogDatabase, type D1DatabaseLike } from '@/lib/logging/query-log';
import { extractChartSummary, type QimenFullResult } from '@/lib/qimen/engine';

export interface QimenHistoryRow {
  id: string;
  created_at: string;
  solar_date: string;
  time_index: number;
  day_ganzhi: string;
  time_ganzhi: string;
  ju_label: string;
  zhifu_desc: string;
  zhishi_desc: string;
  question_type: string;
  question_goal: string;
  patterns: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 从确定性排盘结果提取入库字段（起局要素 + 盘面关键结论 + LLM 上下文骨架） */
export function buildRecordFromResult(result: QimenFullResult): {
  solarDate: string;
  timeIndex: number;
  dayGanZhi: string;
  timeGanZhi: string;
  juLabel: string;
  zhifuDesc: string;
  zhishiDesc: string;
  questionType: string;
  questionGoal: string;
  patterns: string;
  chartSummary: string;
} {
  const { input, ganzhi, chart } = result;
  return {
    solarDate: input.solarDate,
    timeIndex: input.timeIndex,
    dayGanZhi: ganzhi.day || '',
    timeGanZhi: ganzhi.time || '',
    juLabel: `${chart.dunType}${chart.juNumber}局·${chart.yuan}·${chart.activeJie}`,
    zhifuDesc: `${chart.zhifu.star}落${chart.zhifu.palace}宫`,
    zhishiDesc: `${chart.zhishi.door}落${chart.zhishi.palace}宫`,
    questionType: (input.questionType || '').slice(0, 20),
    questionGoal: (input.questionGoal || '').slice(0, 500),
    patterns: JSON.stringify((chart.detectedPatterns || []).map((p) => ({ name: p.name, nature: p.nature }))),
    chartSummary: JSON.stringify(extractChartSummary(result)).slice(0, 12000),
  };
}

/** best-effort 落库：D1 不可用或表未建时静默跳过（返回 false），绝不影响排盘主流程 */
export async function saveQimenRecord(result: QimenFullResult): Promise<boolean> {
  const db = getQueryLogDatabase();
  if (!db) return false;
  try {
    const r = buildRecordFromResult(result);
    await db
      .prepare(
        `INSERT INTO qimen_records (
          id, solar_date, time_index, day_ganzhi, time_ganzhi, ju_label,
          zhifu_desc, zhishi_desc, question_type, question_goal, patterns, chart_summary
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        r.solarDate,
        r.timeIndex,
        r.dayGanZhi,
        r.timeGanZhi,
        r.juLabel,
        r.zhifuDesc,
        r.zhishiDesc,
        r.questionType,
        r.questionGoal,
        r.patterns,
        r.chartSummary,
      )
      .run();
    return true;
  } catch (error) {
    console.error('Qimen history save failed', error instanceof Error ? error.message : 'unknown');
    return false;
  }
}

/** 最近起局记录（时间倒序，不含 chart_summary 大字段）；表未建/查询失败返回 null 由路由降级 */
export async function listQimenRecords(limit: number): Promise<QimenHistoryRow[] | null> {
  const db = getQueryLogDatabase();
  if (!db) return null;
  try {
    const rows = await db
      .prepare(
        `SELECT id, created_at, solar_date, time_index, day_ganzhi, time_ganzhi,
          ju_label, zhifu_desc, zhishi_desc, question_type, question_goal, patterns
         FROM qimen_records
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .bind(Math.min(50, Math.max(1, Math.floor(limit))))
      .all<QimenHistoryRow>();
    return rows.results || [];
  } catch (error) {
    console.error('Qimen history list failed', error instanceof Error ? error.message : 'unknown');
    return null;
  }
}

/** 删除单条历史记录；id 必须为合法 UUID */
export async function deleteQimenRecord(id: string): Promise<boolean> {
  const db = getQueryLogDatabase();
  if (!db || !UUID_RE.test(id)) return false;
  try {
    await db.prepare('DELETE FROM qimen_records WHERE id = ?').bind(id).run();
    return true;
  } catch (error) {
    console.error('Qimen history delete failed', error instanceof Error ? error.message : 'unknown');
    return false;
  }
}

export type { D1DatabaseLike };
