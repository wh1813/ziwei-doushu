import { getQueryLogDatabase } from '@/lib/logging/query-log';
import { extractChartSummary, type QimenFullResult } from '@/lib/qimen/engine';

/**
 * 奇门起局历史：仅后台落库（写入专用）。
 * 设计决策：网站暂无用户账户体系，历史不在前端展示，也不提供公开查询/删除接口
 * （公开列表会暴露所有访客的提问内容）。等账户系统上线后，再按用户隔离重开读写。
 */

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
