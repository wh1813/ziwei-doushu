/**
 * 小六壬（xiaoliuren）— 确定性起课引擎（mainline-cn-v1）
 *
 * 算法（诸葛马前课 / 小六壬掌诀）：
 * 1. 输入：起课时间（公历日期 + 时辰 0-11）+ 问事类型
 * 2. 起课步骤（严格掌诀法）：
 *    - 取农历月/日/时辰序号
 *    - 月宫 = 大安起顺数 m 月（m = 农历月数）
 *    - 日宫 = 月宫起顺数 d 日（d = 农历日数）
 *    - 时宫 = 日宫起顺数 t 时辰（t = 时辰序号 1-12）
 *    - 时宫 = 最终占断结果（大安/留连/速喜/赤口/小吉/空亡）
 * 3. 输出：完整课体 JSON（月/日/时 序号、三步宫位、最终结果、解读字段），LLM 解断的唯一输入
 *
 * 防幻觉核心：LLM 只能引用【确定性骨架】内的字段，不得自行编造六神名/宫位。
 *
 * 历法：依赖 lunar-javascript（与 lib/ziwei 同源库族）。
 */

import { Solar } from 'lunar-javascript';
import { CONSTITUTION } from '@/lib/ai/prompt-constitution';

// ─── 六神（掌诀顺序）───────────────────────

export const LIUSHEN = ['大安', '留连', '速喜', '赤口', '小吉', '空亡'] as const;
export type Liushen = (typeof LIUSHEN)[number];

/** 六神吉凶：大安、速喜、小吉为吉；留连、赤口、空亡为凶 */
const JI_XIONG: Record<Liushen, '大吉' | '中吉' | '小吉' | '小凶' | '中凶' | '大凶'> = {
  '大安': '大吉',
  '速喜': '中吉',
  '小吉': '小吉',
  '留连': '小凶',
  '赤口': '中凶',
  '空亡': '大凶',
};

/** 六神五行 + 方位 + 主数 + 体象 */
const LIUSHEN_META: Record<Liushen, { wuxing: string; fangwei: string; shu: number; tiXiang: string; season: string }> = {
  '大安': { wuxing: '木', fangwei: '东方', shu: 145, tiXiang: '青龙', season: '春' },
  '留连': { wuxing: '土', fangwei: '四角', shu: 278, tiXiang: '勾陈', season: '四季' },
  '速喜': { wuxing: '火', fangwei: '南方', shu: 369, tiXiang: '朱雀', season: '夏' },
  '赤口': { wuxing: '金', fangwei: '西方', shu: 412, tiXiang: '白虎', season: '秋' },
  '小吉': { wuxing: '水', fangwei: '北方', shu: 538, tiXiang: '玄武', season: '冬' },
  '空亡': { wuxing: '土', fangwei: '中央', shu: 6510, tiXiang: '勾陈', season: '无' },
};

/** 12 时辰序号（用于掌诀顺数）：子=1, 丑=2, ..., 亥=12 */
const TIME_INDEX_OFFSET = 1;  // timeIndex 0 → 子时(序号1)，timeIndex 11 → 亥时(序号12)

// ─── 核心算法 ────────────────────────────

/** 六神索引 0-5 */
function liuShenAt(ordinalFromDaAn: number): Liushen {
  // 0-indexed offset: 0=大安, 1=留连, ..., 5=空亡
  return LIUSHEN[((ordinalFromDaAn % 6) + 6) % 6];
}

/** 掌诀顺数：从 startLiushen 起顺数 n 步（n ≥ 0），返回最终落点 */
function stepFrom(start: Liushen, n: number): Liushen {
  const startIdx = LIUSHEN.indexOf(start);
  return liuShenAt(startIdx + n);
}

// ─── 类型 ──────────────────────────────

export interface XiaoliurenInput {
  solarDate: string;   // YYYY-MM-DD
  timeIndex: number;   // 0-11
  questionType: string;
  questionGoal: string;
  gender?: '男' | '女' | '不指定';
}

export interface XiaoliurenResult {
  input: XiaoliurenInput;
  /** 农历四柱 */
  lunar: {
    yearZodiac: string;          // 生肖
    month: number;               // 农历月（1-12）
    day: number;                 // 农历日（1-30）
    yearGanZhi: string;
    monthGanZhi: string;
    dayGanZhi: string;
    timeGanZhi: string;
  };
  /** 时辰序号（1-12） */
  timeOrdinal: number;
  /** 三步掌诀顺数过程 */
  steps: {
    /** 月宫 = 大安起顺数 m 月 */
    monthGong: Liushen;
    /** 日宫 = 月宫起顺数 d 日 */
    dayGong: Liushen;
    /** 时宫 = 日宫起顺数 t 时辰（最终结果） */
    timeGong: Liushen;
  };
  /** 最终占断结果（= 时宫） */
  result: {
    liuShen: Liushen;
    jiXiong: '大吉' | '中吉' | '小吉' | '小凶' | '中凶' | '大凶';
    wuxing: string;
    fangwei: string;
    tiXiang: string;
    shu: string;          // 主数（如 "1、4、5"）
    season: string;
    brief: string;        // 简短体象描述
  };
  warnings: string[];
}

export interface XiaoliurenValidation {
  ok: boolean;
  error?: string;
}

// ─── 校验 ──────────────────────────────

export function validateXiaoliurenInput(input: Partial<XiaoliurenInput>): XiaoliurenValidation {
  if (!input.solarDate || typeof input.solarDate !== 'string') {
    return { ok: false, error: 'solarDate 必填，YYYY-MM-DD' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.solarDate)) {
    return { ok: false, error: 'solarDate 必须是 YYYY-MM-DD 格式' };
  }
  const [y, m, d] = input.solarDate.split('-').map(Number);
  if (!Number.isFinite(y) || y < 1900 || y > 2049) {
    return { ok: false, error: 'solarDate 年份必须在 1900-2049' };
  }
  if (!Number.isFinite(m) || m < 1 || m > 12) {
    return { ok: false, error: 'solarDate 月份必须在 1-12' };
  }
  if (!Number.isFinite(d) || d < 1 || d > 31) {
    return { ok: false, error: 'solarDate 日期必须在 1-31' };
  }
  // 真实日期合法性（lunar-javascript 会兜底，但这里做基本检查）
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return { ok: false, error: 'solarDate 不是有效日期' };
  }
  if (typeof input.timeIndex !== 'number' || input.timeIndex < 0 || input.timeIndex > 11) {
    return { ok: false, error: 'timeIndex 必须是 0-11' };
  }
  return { ok: true };
}

// ─── 课体简述（按六神 + 吉凶） ─────────────────

const RESULT_BRIEF: Record<Liushen, string> = {
  '大安': '事体安稳，可成；求谋遂意，宜守正不动',
  '留连': '事有阻滞，拖延未定；宜守待时，缓行可成',
  '速喜': '喜事速至，逢凶化吉；宜把握时机，主动进取',
  '赤口': '口舌争竞，官非缠扰；宜缄默退让，避免冲突',
  '小吉': '小有所成，终得善果；宜耐心等待，稳中求进',
  '空亡': '谋事落空，徒劳无功；宜改弦更张，另择时机',
};

// ─── 起课主函数 ─────────────────────────

export function castXiaoliurenChart(input: XiaoliurenInput): XiaoliurenResult {
  const v = validateXiaoliurenInput(input);
  if (!v.ok) throw new Error(v.error || '输入不合法');

  const [y, m, d] = input.solarDate.split('-').map(Number);
  const solar = Solar.fromYmd(y, m, d);
  const lunar = solar.getLunar();

  // 农历字段
  const lunarMonth = lunar.getMonth();
  const lunarDay = lunar.getDay();
  const yearGz = lunar.getYearInGanZhiExact();
  const monthGz = lunar.getMonthInGanZhiExact();
  const dayGz = lunar.getDayInGanZhiExact();
  const timeGz = lunar.getTimeInGanZhi();

  // 生肖
  const yearZodiac = lunar.getYearShengXiao();

  // 时辰序号 1-12
  const timeOrdinal = input.timeIndex + TIME_INDEX_OFFSET;

  // 掌诀三步
  const monthGong = liuShenAt(lunarMonth - 1);   // 大安起 1 月 = 大安起 0 步
  const dayGong = stepFrom(monthGong, lunarDay - 1); // 月宫起 1 日 = 月宫起 0 步
  const timeGong = stepFrom(dayGong, timeOrdinal - 1); // 日宫起子时 = 日宫起 0 步

  // 最终结果
  const meta = LIUSHEN_META[timeGong];
  const brief = RESULT_BRIEF[timeGong];

  const warnings: string[] = [];
  if (lunarDay > 29) {
    warnings.push('农历日为大月第 30 日，请核对历法');
  }

  return {
    input,
    lunar: {
      yearZodiac,
      month: lunarMonth,
      day: lunarDay,
      yearGanZhi: yearGz,
      monthGanZhi: monthGz,
      dayGanZhi: dayGz,
      timeGanZhi: timeGz,
    },
    timeOrdinal,
    steps: {
      monthGong,
      dayGong,
      timeGong,
    },
    result: {
      liuShen: timeGong,
      jiXiong: JI_XIONG[timeGong],
      wuxing: meta.wuxing,
      fangwei: meta.fangwei,
      tiXiang: meta.tiXiang,
      shu: String(meta.shu),
      season: meta.season,
      brief,
    },
    warnings,
  };
}

// ─── 落库摘要 ─────────────────────────

export function extractChartSummary(result: XiaoliurenResult): Record<string, unknown> {
  return {
    lunar: result.lunar,
    timeOrdinal: result.timeOrdinal,
    steps: result.steps,
    result: result.result,
    warnings: result.warnings,
  };
}

// ─── Prompt 构建 ────────────────────────

export function buildXiaoliurenPrompt(
  input: XiaoliurenInput,
  result: XiaoliurenResult,
  summary: Record<string, unknown>,
): { systemPrompt: string; userPrompt: string; chartContext: string } {
  const systemPrompt = `${CONSTITUTION}

【小六壬解课铁律】
- 小六壬为速断课法：以时宫（最终宫位）一宫断事，不展开四柱八字、天地盘等结构。
- 三步掌诀顺序：大安→月宫→日宫→时宫；时宫即为所问之事的当前定数。
- 六神吉凶判定：大安（青龙木，东方，春季，大吉）、速喜（朱雀火，南方，夏季，中吉）、小吉（玄武水，北方，冬季，小吉）为吉；留连（勾陈土，四季，小凶）、赤口（白虎金，西方，秋季，中凶）、空亡（勾陈土，中央，大凶）为凶。
- 体象简述必须严格依据确定性骨架 result.steps / result.result 字段，**不得编造六神名或主数**。
- 输出分三段：①时宫总论（吉凶 + 体象简述）②按问事类型展开（求财/事业/感情/考试/健康……）③调理建议（方位 + 时机 + 心态）。

【小六壬输出格式】
- 用纯文字分小节呈现，避免 Markdown 大标题与列表化堆砌
- 总字数 350-600 字为宜，避免空泛宽泛
- 调理建议具体到方位（时宫对应方位）+ 时机（近期 vs 中期）+ 心态（一句话关键词）
- 仅供娱乐参考：不做医疗/投资/法律决策`;

  const chartContext = `【课体骨架（确定性）】
起课时间：${input.solarDate}（${result.lunar.timeGanZhi}时，占时序号 ${result.timeOrdinal}）
农历：${result.lunar.yearGanZhi}年 ${result.lunar.monthGanZhi}月 ${result.lunar.dayGanZhi}日 ${result.lunar.timeGanZhi}时
生肖：${result.lunar.yearZodiac}年

掌诀三步：
① 大安起 ${result.lunar.month} 月 → 月宫 = ${result.steps.monthGong}
② ${result.steps.monthGong}起 ${result.lunar.day} 日 → 日宫 = ${result.steps.dayGong}
③ ${result.steps.dayGong}起 ${result.timeOrdinal} 时辰 → 时宫 = ${result.steps.timeGong}

最终结果：${result.result.liuShen}（${result.result.jiXiong}）
五行：${result.result.wuxing} · 方位：${result.result.fangwei} · 体象：${result.result.tiXiang} · 主数：${result.result.shu} · 季：${result.result.season}
简述：${result.result.brief}
${result.warnings.length > 0 ? `\n边界提醒：${result.warnings.join(' / ')}` : ''}`;

  const userPrompt = `请按上述 systemPrompt 解读下列小六壬课体：

${chartContext}

问事：${input.questionType}
${input.questionGoal ? `具体问题：${input.questionGoal}` : '（无具体问题，请按问事类型给通用建议）'}
${input.gender && input.gender !== '不指定' ? `占者性别：${input.gender}` : ''}`;

  return { systemPrompt, userPrompt, chartContext };
}