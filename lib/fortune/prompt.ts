// lib/fortune/prompt.ts
// 运势中心 V1.0 Prompt 拼装
//
// systemPrompt = CONSTITUTION + FORTUNE_SYSTEM
// userPrompt = 用户期/聚焦维度/可选生辰 + 各模块 summary + 跨模块交叉指令
//
// 设计原则（与规划文档 R18-7 对齐）：
// - 禁止杜撰：未在 summary 出现的事实不得编造
// - 每模块要点 ≤ 2 句
// - 跨模块印证：仅标注"一致/互补/分歧"，不强行调和
// - 行动建议 ≤ 2 条/聚焦维度
// - 必含【五、边界声明】复述 CONSTITUTION 隐私/边界条款

import { CONSTITUTION } from '@/lib/ai/prompt-constitution';
import type { FortuneContext } from './extract';

export type FortunePeriod = 'month' | 'season' | 'year';
export type FortuneFocus = 'career' | 'relationship' | 'health' | 'wealth' | 'overall';

export const FORTUNE_PERIODS: Record<FortunePeriod, string> = {
  month: '本月（未来 30 天）',
  season: '本季（未来 90 天）',
  year: '本年（未来 12 个月）',
};

export const FORTUNE_FOCUSES: Record<FortuneFocus, string> = {
  career: '事业',
  relationship: '感情',
  health: '健康',
  wealth: '财运',
  overall: '综合',
};

const FORTUNE_SYSTEM = `【运势中心·跨模块综合解读铁律】

你是一名跨模块玄学综合解读师。用户提交了 1-4 个术数模块的起局 JSON（奇门遁甲 / 周易六爻 / 大六壬 / 小六壬），请按以下五段结构给出综合报告。

【一、子模块关键点摘录】（必含）
- 对用户提交的每个模块，用 1-2 句话点出其核心结论
- 必须基于本提示中提供的 summary JSON；summary 未出现的事实禁止编造
- 若 summary 内容与该模块常识严重冲突（如缺用神、缺主格局），需诚实指出"信息不足"

【二、跨模块交叉印证】（必含）
- 标注模块间是"一致"（多模块指向同一方向）、"互补"（各讲一面合起来才完整）、还是"分歧"（结论冲突）
- 不强行调和：若多模块结论冲突，如实写"奇门显示 X，六爻显示 Y，倾向以 Y 为近期主导（建议以与本期/聚焦维度更直接相关的模块为准）"

【三、本期要点】
- 围绕用户指定的 period（本月 / 本季 / 本年）展开
- 不要脱离时间范围做"一辈子"的空话
- 给出 3-5 个关键观察点，每点 1 句话

【四、行动建议】
- 围绕用户指定的 focus（事业 / 感情 / 健康 / 财运 / 综合）展开
- 每个聚焦维度给 1-2 条具体可执行的行动建议（物品类用"如"列举 3-5 个具体实物，方位类落到"主卧床头 / 客厅西墙 / 办公工位左侧"等具体空间）
- 严禁医疗 / 法律 / 金融投资具体决策

【五、边界声明】（必含，原样复述）
- 本报告仅基于提交 JSON 内的盘面信息，不构成医疗、法律、金融投资建议
- 不预测具体事件时间点，不保证结果
- 解读仅供参考，重大决策请咨询专业人士

【纯文本输出铁律】
- 严格纯文本，禁止任何 Markdown 符号（# * - 等）
- 段间用空行分隔，章节用【一、】【二、】…标记
- 中文标点
- 不得开场白；直接进入【一、】`;

const MODULE_LABEL: Record<string, string> = {
  qimen: '奇门遁甲',
  liuyao: '周易六爻',
  daliuren: '大六壬',
  xiaoliuren: '小六壬',
};

export interface FortunePromptInput {
  period: FortunePeriod;
  focus: FortuneFocus;
  birthDate?: string | null;
  birthTimeIndex?: number | null;
}

export interface FortunePromptResult {
  systemPrompt: string;
  userPrompt: string;
  chartContext: string; // 落库 query_log 用，含期/聚焦维度/各模块摘要
}

export function buildFortunePrompt(
  input: FortunePromptInput,
  context: FortuneContext,
): FortunePromptResult {
  const systemPrompt = [CONSTITUTION, FORTUNE_SYSTEM].join('\n\n');

  const periodLabel = FORTUNE_PERIODS[input.period] ?? input.period;
  const focusLabel = FORTUNE_FOCUSES[input.focus] ?? input.focus;

  const chartLines: string[] = [];
  for (const c of context.charts) {
    chartLines.push(`【${MODULE_LABEL[c.module] ?? c.module}】`);
    chartLines.push(c.summaryText);
    chartLines.push('');
  }

  const birthLine = input.birthDate
    ? `用户生辰：${input.birthDate}（出生时辰序号 ${input.birthTimeIndex ?? '未知'}）`
    : '用户未提供生辰信息，所有解读仅基于盘面结构，不引用日主/用神类推断。';

  const userPrompt = [
    `时间范围：${periodLabel}`,
    `聚焦维度：${focusLabel}`,
    birthLine,
    '',
    '以下为各模块的起局摘要（确定性引擎产出）：',
    '',
    ...chartLines,
    '请按系统提示的五段结构给出综合报告。',
  ].join('\n');

  // chartContext 记录到 ai_query_logs，保留期/聚焦维度/模块摘要供后台追溯
  const chartContext = [
    `period=${input.period} focus=${input.focus} birth=${input.birthDate ?? 'none'}/${input.birthTimeIndex ?? 'none'}`,
    '---',
    ...chartLines,
  ].join('\n');

  return { systemPrompt, userPrompt, chartContext };
}
