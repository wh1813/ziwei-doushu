/**
 * 大六壬（daliuren）— 起课落库 + 解课回填（best-effort）
 *
 * 数据流：
 *   1) 起课接口（/api/daliuren-chart）调用 saveDaliurenRecord → 落库到 daliuren_records
 *      - 字段：起课四柱、月将、天乙贵人、四课、三传 + 六亲、课体名、warnings、chartSummary JSON
 *      - chart_payload 字段保存完整起课 JSON（不超过 16k），便于后续历史查阅
 *      - 成功返回新记录 id（UUID），D1 不可用时静默返回 null
 *   2) 解课接口（/api/daliuren-interpret）调用 updateDaliurenRecordInterpret → 回填 interpret_text
 *      - 成功返回 true，迁移 0005 未应用时静默返回 false
 *
 * 表 schema 见 migrations/0005_divination_records.sql。
 * 既有约定：表名 snake_case + _records 后缀；id 为 TEXT PK；interpret_text 50k 上限。
 */

import { getQueryLogDatabase } from '@/lib/logging/query-log';
import { saveDivinationRecord, updateDivinationRecordInterpret } from '@/lib/divination/history';
import {
  CHART_PAYLOAD_MAX,
  type DivinationModule,
} from '@/lib/divination/types';
import { extractChartSummary, type DaliurenFullResult } from './engine';

const MODULE: DivinationModule = 'daliuren';
const TABLE = 'daliuren_records';

/** 从确定性起课结果提取入库字段 */
function buildRecordFields(result: DaliurenFullResult): {
  columns: string[];
  values: unknown[];
} {
  const { input, ganzhi, pan, guiren, siKe, sanChuan, sanChuanLiuqin } = result;
  const chartSummary = JSON.stringify(extractChartSummary(result)).slice(0, 12000);
  const chartPayload = JSON.stringify(result).slice(0, CHART_PAYLOAD_MAX);
  return {
    columns: [
      'solar_date',
      'time_index',
      'day_ganzhi',
      'time_ganzhi',
      'month_zhi',
      'yue_jiang',
      'gui_ren_zhi',
      'gui_ren_cheng',
      'si_ke_first',
      'si_ke_second',
      'si_ke_third',
      'si_ke_fourth',
      'san_chuan_chu',
      'san_chuan_zhong',
      'san_chuan_mo',
      'ke_ti',
      'chu_liuqin',
      'zhong_liuqin',
      'mo_liuqin',
      'question_type',
      'question_goal',
      'chart_summary',
      'chart_payload',
    ],
    values: [
      input.solarDate,
      input.timeIndex,
      ganzhi.day || '',
      ganzhi.time || '',
      ganzhi.monthZhi || '',
      pan.yueJiang || '',
      guiren.used.zhi || '',
      guiren.used.cheng || '',
      `${siKe.first.xia}上${siKe.first.shang}`,
      `${siKe.second.xia}上${siKe.second.shang}`,
      `${siKe.third.xia}上${siKe.third.shang}`,
      `${siKe.fourth.xia}上${siKe.fourth.shang}`,
      `${sanChuan.chu.zhi}${sanChuan.chu.gan}`,
      `${sanChuan.zhong.zhi}${sanChuan.zhong.gan}`,
      `${sanChuan.mo.zhi}${sanChuan.mo.gan}`,
      sanChuan.keti,
      sanChuanLiuqin.chu,
      sanChuanLiuqin.zhong,
      sanChuanLiuqin.mo,
      (input.questionType || '').slice(0, 20),
      (input.questionGoal || '').slice(0, 500),
      chartSummary,
      chartPayload,
    ],
  };
}

/** best-effort 落库：D1 不可用或表未建时静默返回 null，绝不影响起课主流程 */
export async function saveDaliurenRecord(result: DaliurenFullResult): Promise<string | null> {
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
export async function updateDaliurenRecordInterpret(
  recordId: string,
  interpretText: string,
): Promise<boolean> {
  return updateDivinationRecordInterpret(MODULE, recordId, interpretText);
}

/** 表名导出（供调试/迁移脚本读表） */
export const DALIUREN_TABLE = TABLE;
