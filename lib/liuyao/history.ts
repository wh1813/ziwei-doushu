/**
 * 六爻（liuyao）— 起卦落库 + 解卦回填（best-effort）
 *
 * 数据流：
 *   1) 起卦接口（/api/liuyao-chart）调用 saveLiuyaoRecord → 落库到 sixyao_records
 *      - 字段：起卦四柱、本卦/变卦、世应、动爻、用神推算理由、patterns 摘要、chartSummary JSON
 *      - chart_payload 字段保存完整起卦 JSON（不超过 16k），便于后续历史查阅
 *      - 成功返回新记录 id（UUID），D1 不可用时静默返回 null
 *   2) 解卦接口（/api/liuyao-interpret）调用 updateLiuyaoRecordInterpret → 回填 interpret_text
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
import { extractChartSummary, type LiuyaoFullResult } from './engine';

const MODULE: DivinationModule = 'sixyao';
const TABLE = 'sixyao_records';

/** 从确定性排卦结果提取入库字段 */
function buildRecordFields(result: LiuyaoFullResult): {
  columns: string[];
  values: unknown[];
} {
  const { input, ganzhi, chart, yongShen, detectedPatterns } = result;
  const chartSummary = JSON.stringify(extractChartSummary(result)).slice(0, 12000);
  const chartPayload = JSON.stringify(result).slice(0, CHART_PAYLOAD_MAX);
  const patterns = JSON.stringify(
    (detectedPatterns || []).map((p) => ({ name: p.name, nature: p.nature })),
  );
  return {
    columns: [
      'solar_date',
      'time_index',
      'day_ganzhi',
      'time_ganzhi',
      'ben_gua',
      'bian_gua',
      'gua_gong',
      'gua_gong_wuxing',
      'shi_yao_index',
      'ying_yao_index',
      'dong_yao_indices',
      'liuqin_of_self',
      'yongshen_name',
      'yongshen_position',
      'question_type',
      'question_goal',
      'patterns',
      'chart_summary',
      'chart_payload',
    ],
    values: [
      input.solarDate,
      input.timeIndex,
      ganzhi.day || '',
      ganzhi.time || '',
      chart.benGua,
      chart.bianGua,
      chart.guaGong,
      chart.guaGongWuxing,
      chart.shiYaoIndex,
      chart.yingYaoIndex,
      JSON.stringify(chart.dongYaoIndices || []),
      chart.liuqinOfSelf,
      yongShen.name,
      yongShen.position,
      (input.questionType || '').slice(0, 20),
      (input.questionGoal || '').slice(0, 500),
      patterns,
      chartSummary,
      chartPayload,
    ],
  };
}

/** best-effort 落库：D1 不可用或表未建时静默返回 null，绝不影响排卦主流程 */
export async function saveLiuyaoRecord(result: LiuyaoFullResult): Promise<string | null> {
  const db = getQueryLogDatabase();
  if (!db) return null;
  const fields = buildRecordFields(result);
  return saveDivinationRecord({
    table: TABLE,
    columns: fields.columns,
    values: fields.values,
  });
}

/** best-effort 回填解卦正文（50000 上限）；迁移 0005 未应用时静默返回 false */
export async function updateLiuyaoRecordInterpret(
  recordId: string,
  interpretText: string,
): Promise<boolean> {
  return updateDivinationRecordInterpret(MODULE, recordId, interpretText);
}

/** 表名导出（供调试/迁移脚本读表） */
export const LIUYAO_TABLE = TABLE;