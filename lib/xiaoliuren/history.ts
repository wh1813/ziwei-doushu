/**
 * 小六壬（xiaoliuren）— 起课落库 + 解课回填（best-effort）
 *
 * 数据流：
 *   1) 起课接口（/api/xiaoliuren-chart）调用 saveXiaoliurenRecord → 落库到 xiaoliuren_records
 *      - 字段：农历月/日/时辰序号 + 三步宫位 + 最终结果 + warnings + chartSummary JSON
 *      - chart_payload 保存完整起课 JSON（不超过 16k），便于后续历史查阅
 *      - 成功返回新记录 id（UUID），D1 不可用时静默返回 null
 *   2) 解课接口（/api/xiaoliuren-interpret）调用 updateXiaoliurenRecordInterpret → 回填 interpret_text
 *      - 成功返回 true，迁移 0005 未应用时静默返回 false
 *
 * 表 schema 见 migrations/0005_divination_records.sql（与其它 divination 模块共享）。
 * 既有约定：表名 snake_case + _records 后缀；id 为 TEXT PK；interpret_text 50k 上限。
 */

import { getQueryLogDatabase } from '@/lib/logging/query-log';
import { saveDivinationRecord, updateDivinationRecordInterpret } from '@/lib/divination/history';
import {
  CHART_PAYLOAD_MAX,
  type DivinationModule,
} from '@/lib/divination/types';
import { extractChartSummary, type XiaoliurenResult } from './engine';

const MODULE: DivinationModule = 'xiaoliuren';
const TABLE = 'xiaoliuren_records';

/** 从确定性起课结果提取入库字段 */
function buildRecordFields(result: XiaoliurenResult): {
  columns: string[];
  values: unknown[];
} {
  const { input, lunar, timeOrdinal, steps, result: res, warnings } = result;
  const chartSummary = JSON.stringify(extractChartSummary(result)).slice(0, 12000);
  const chartPayload = JSON.stringify(result).slice(0, CHART_PAYLOAD_MAX);
  return {
    columns: [
      'solar_date',
      'time_index',
      'time_ordinal',
      'lunar_month',
      'lunar_day',
      'year_ganzhi',
      'day_ganzhi',
      'time_ganzhi',
      'month_gong',
      'day_gong',
      'time_gong',
      'result_ji_xiong',
      'question_type',
      'question_goal',
      'chart_summary',
      'chart_payload',
    ],
    values: [
      input.solarDate,
      input.timeIndex,
      timeOrdinal,
      lunar.month,
      lunar.day,
      lunar.yearGanZhi || '',
      lunar.dayGanZhi || '',
      lunar.timeGanZhi || '',
      steps.monthGong,
      steps.dayGong,
      steps.timeGong,
      res.jiXiong,
      (input.questionType || '').slice(0, 20),
      (input.questionGoal || '').slice(0, 500),
      chartSummary,
      chartPayload,
    ],
  };
}

/** best-effort 落库：D1 不可用或表未建时静默返回 null，绝不影响起课主流程 */
export async function saveXiaoliurenRecord(result: XiaoliurenResult): Promise<string | null> {
  const db = getQueryLogDatabase();
  if (!db) return null;
  const fields = buildRecordFields(result);
  return saveDivinationRecord({
    table: TABLE,
    columns: fields.columns,
    values: fields.values,
  });
}

/** best-effort 回填解课正文（50000 上限）；迁移 0005 未应用时静默返回 false */
export async function updateXiaoliurenRecordInterpret(
  recordId: string,
  interpretText: string,
): Promise<boolean> {
  return updateDivinationRecordInterpret(MODULE, recordId, interpretText);
}

/** 表名导出（供调试/迁移脚本读表） */
export const XIAOLIUREN_TABLE = TABLE;