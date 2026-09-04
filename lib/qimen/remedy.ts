import { Solar } from 'lunar-javascript';
import { TIME_INDEX_TO_HOUR, XUNSHOU_TO_HIDDEN_YI } from './engine';
import type { QimenChart, QimenFullResult } from './engine';

/**
 * 奇门用神定位与不利状态检测 —— 解盘优化层（荀爽方法论）
 *
 * 职责边界（防幻觉核心，与排盘引擎严格分离，保证黄金回归零影响）：
 *  1. 出生八字换算：出生日期(+时辰) → 八字日干支 / 生年干支（年干支按立春边界、
 *     日干支按八字换日规则即 23:00 后算次日，与 lunar-javascript Exact 系列一致）
 *  2. 用神落宫定位（在"当前时间起好的盘"中定位）：
 *     - 本人 = 出生日干（日干为甲者，取出生旬首所遁之仪代理入盘定位）
 *     - 日干合神 = 本人符号的天干五合之干（丁壬合、乙庚合、甲己合、丙辛合、戊癸合）
 *     - 生年干（财富/事业加看）：生年干为甲者以值符为代表，另以遁仪戊作盘面代理
 *  3. 不利状态检测：六仪击刑 / 天盘干入墓 / 空亡（时旬空为主、日旬空为辅）
 *  4. 事实化输出：全部落宫与状态由本模块预计算，LLM 只引用、严禁自行重定位
 *
 * 规则口径（通行标准；参考脚本 qimen_cli.py 未定义击刑/入墓，此处为附加检测层）：
 *  - 六仪击刑（天盘六仪落刑宫）：甲子戊落震三宫（子刑卯）、甲戌己落坤二宫（戌刑未）、
 *    甲申庚落艮八宫（申刑寅）、甲午辛落离九宫（午午自刑）、甲辰壬落巽四宫（辰自刑）、
 *    甲寅癸落巽四宫（寅刑巳）
 *  - 天盘干入墓：乙丙戊墓于戌（乾六宫）、丁己庚墓于丑（艮八宫）、辛壬墓于辰（巽四宫）、
 *    癸墓于未（坤二宫）
 *  - 天干五合：甲己、乙庚、丙辛、丁壬、戊癸
 *  - 本盘规则固定"置闰 + 转盘、中宫寄坤"，与荀爽体系要求的排盘口径一致
 */

// ─── 常量表 ───────────────────────────────────────────────

/** 天干五合伙伴 */
const WU_HE_PARTNER: Record<string, string> = {
  甲: '己', 己: '甲',
  乙: '庚', 庚: '乙',
  丙: '辛', 辛: '丙',
  丁: '壬', 壬: '丁',
  戊: '癸', 癸: '戊',
};

/** 六仪击刑：仪 → 刑宫 */
const JI_XING_TABLE: Record<string, number> = { 戊: 3, 己: 2, 庚: 8, 辛: 9, 壬: 4, 癸: 4 };

const JI_XING_REASON: Record<string, string> = {
  戊: '甲子戊落震三宫，子刑卯',
  己: '甲戌己落坤二宫，戌刑未',
  庚: '甲申庚落艮八宫，申刑寅',
  辛: '甲午辛落离九宫，午午自刑',
  壬: '甲辰壬落巽四宫，辰辰自刑',
  癸: '甲寅癸落巽四宫，寅刑巳',
};

/** 天盘干入墓：干 → 墓库宫位 */
const RU_MU_TABLE: Record<string, number> = {
  乙: 6, 丙: 6, 戊: 6,
  丁: 8, 己: 8, 庚: 8,
  辛: 4, 壬: 4,
  癸: 2,
};

const RU_MU_REASON: Record<string, string> = {
  乙: '乙木墓于戌（乾六宫）',
  丙: '丙火墓于戌（乾六宫）',
  戊: '戊土墓于戌（乾六宫）',
  丁: '丁火墓于丑（艮八宫）',
  己: '己土墓于丑（艮八宫）',
  庚: '庚金墓于丑（艮八宫）',
  辛: '辛金墓于辰（巽四宫）',
  壬: '壬水墓于辰（巽四宫）',
  癸: '癸水墓于未（坤二宫）',
};

const SHI_CHEN_LABEL = [
  '早子时(00-01)', '丑时(01-03)', '寅时(03-05)', '卯时(05-07)', '辰时(07-09)',
  '巳时(09-11)', '午时(11-13)', '未时(13-15)', '申时(15-17)', '酉时(17-19)',
  '戌时(19-21)', '亥时(21-23)', '晚子时(23-24)',
];

// ─── 输入校验 ─────────────────────────────────────────────

export interface BirthInput {
  birthDate: string; // YYYY-MM-DD 阳历
  birthTimeIndex?: number | null; // 0~12，同起局时辰约定；缺省按正午（不触子时换日边界）
}

/** 校验出生信息。返回错误文案或 null。 */
export function validateBirthInput(p: { birthDate?: unknown; birthTimeIndex?: unknown }): string | null {
  if (typeof p.birthDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.birthDate)) {
    return '出生日期格式应为 YYYY-MM-DD。';
  }
  const [y] = p.birthDate.split('-').map(Number);
  if (y < 1900 || y > 2049) {
    return '出生日期需在 1900-2049 年之间。';
  }
  const probe = new Date(`${p.birthDate}T00:00:00Z`);
  if (Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== p.birthDate) {
    return '出生日期无效，请核对年月日。';
  }
  if (p.birthTimeIndex !== undefined && p.birthTimeIndex !== null) {
    const t = p.birthTimeIndex;
    if (typeof t !== 'number' || !Number.isInteger(t) || t < 0 || t > 12) {
      return '出生时辰无效（0~12，0 为早子时，12 为晚子时）。';
    }
  }
  return null;
}

/**
 * 从请求体提取可选出生信息：
 *  - 未提供 birthDate（undefined/null/空串）→ { birth: null }（不做个人用神分析）
 *  - 提供但格式非法 → { error: 文案 }（路由转 400）
 *  - 合法 → { birth: BirthInput }
 */
export function parseBirthInput(body: {
  birthDate?: unknown;
  birthTimeIndex?: unknown;
}): { birth: BirthInput | null; error: string | null } {
  const bd = body.birthDate;
  if (bd === undefined || bd === null || (typeof bd === 'string' && bd.trim() === '')) {
    return { birth: null, error: null };
  }
  if (typeof bd !== 'string') {
    return { birth: null, error: '出生日期格式应为 YYYY-MM-DD。' };
  }
  const err = validateBirthInput({ birthDate: bd.trim(), birthTimeIndex: body.birthTimeIndex });
  if (err) return { birth: null, error: err };
  const timeRaw = body.birthTimeIndex;
  const hasTime = timeRaw !== undefined && timeRaw !== null;
  if (hasTime && (typeof timeRaw !== 'number' || !Number.isInteger(timeRaw))) {
    return { birth: null, error: '出生时辰无效（0~12，0 为早子时，12 为晚子时）。' };
  }
  return {
    birth: {
      birthDate: bd.trim(),
      birthTimeIndex: hasTime ? (timeRaw as number) : null,
    },
    error: null,
  };
}

// ─── 结构定义 ─────────────────────────────────────────────

export interface StemStates {
  jiXing: boolean;
  jiXingDetail: string | null;
  ruMu: boolean;
  ruMuDetail: string | null;
  kongWangShi: boolean; // 落时旬空亡
  kongWangRi: boolean; // 落日旬空亡
  kongWangDetail: string | null;
}

export interface SymbolPlacement {
  role: string; // 本人（八字日干）/ 日干合神（日干五合之干）/ 生年干
  birthStem: string; // 出生干（甲未代理前的原始干）
  sourceStem: string; // 实际用于定位与状态检测的盘面天干（甲取遁仪代理）
  displaySymbol: string; // 展示用符号
  onPlate: '天盘' | '地盘';
  rawPalace: number | null;
  palace: number | null; // 寄坤后宫位
  palaceName: string | null;
  direction: string | null;
  states: StemStates;
  note: string | null;
}

export interface ChartUnfavorableItem {
  palace: number;
  palaceName: string;
  direction: string;
  skyStem: string;
  earthStem: string | null;
  reason: string;
}

export interface ChartUnfavorable {
  jiXing: ChartUnfavorableItem[];
  ruMu: ChartUnfavorableItem[];
}

export interface PersonalAnalysis {
  birth: { date: string; timeIndex: number | null; hourLabel: string | null };
  baZi: { dayGanZhi: string; yearGanZhi: string };
  self: SymbolPlacement;
  partner: SymbolPlacement | null;
  yearSymbol: SymbolPlacement & {
    zhifuProxy: { star: string; palace: number; palaceName: string | null; direction: string | null } | null;
  };
  liuhe: { palace: number | null; palaceName: string | null; direction: string | null; kongWang: boolean };
  guGuaHint: string | null; // 孤辰寡宿（年支亥子丑）提示
  facts: string[]; // 事实结论（LLM 直接引用）
  remedyHints: string[]; // 已触发的化解手册条目
}

// ─── 内部算子 ─────────────────────────────────────────────

function palaceMeta(chart: QimenChart, palace: number | null) {
  if (palace === null) return null;
  return chart.palaces.find((p) => p.palace === palace) ?? null;
}

function hostedPalace(palace: number): number {
  return palace === 5 ? 2 : palace; // 中宫寄坤二宫
}

/** 在当前盘中定位某天干：天盘优先，地盘兜底（中宫寄坤） */
function locateStem(
  chart: QimenChart,
  stem: string,
): { onPlate: '天盘' | '地盘'; rawPalace: number; palace: number } | null {
  for (const p of chart.palaces) {
    if (!p.isCenter && p.skyStem === stem) {
      return { onPlate: '天盘', rawPalace: p.palace, palace: p.palace };
    }
  }
  for (const p of chart.palaces) {
    if (p.earthStem === stem) {
      return { onPlate: '地盘', rawPalace: p.palace, palace: hostedPalace(p.palace) };
    }
  }
  return null;
}

/** 天盘干状态检测：击刑 / 入墓 / 空亡 */
function evaluateStates(chart: QimenChart, stem: string, placement: { onPlate: '天盘' | '地盘'; palace: number }): StemStates {
  const states: StemStates = {
    jiXing: false, jiXingDetail: null,
    ruMu: false, ruMuDetail: null,
    kongWangShi: false, kongWangRi: false, kongWangDetail: null,
  };

  if (placement.onPlate === '天盘') {
    const xingPalace = JI_XING_TABLE[stem];
    if (xingPalace !== undefined && xingPalace === placement.palace) {
      states.jiXing = true;
      states.jiXingDetail = `${stem}仪击刑：${JI_XING_REASON[stem]}`;
    }
    const muPalace = RU_MU_TABLE[stem];
    if (muPalace !== undefined && muPalace === placement.palace) {
      states.ruMu = true;
      states.ruMuDetail = `${stem}入墓：${RU_MU_REASON[stem]}`;
    }
  }

  if (chart.kongwangPalaces.includes(placement.palace)) {
    states.kongWangShi = true;
  }
  if (chart.dayKongwangPalaces.includes(placement.palace)) {
    states.kongWangRi = true;
  }
  if (states.kongWangShi || states.kongWangRi) {
    const parts: string[] = [];
    if (states.kongWangShi) parts.push(`落时旬空亡（${chart.kongwang.join('')}空）`);
    if (states.kongWangRi) parts.push(`落日旬空亡（${chart.dayKongwang.join('')}空）`);
    states.kongWangDetail = parts.join('；');
  }
  return states;
}

function buildPlacement(
  chart: QimenChart,
  role: string,
  birthStem: string,
  sourceStem: string,
  displaySymbol: string,
  note: string | null,
): SymbolPlacement {
  const located = locateStem(chart, sourceStem);
  if (!located) {
    return {
      role, birthStem, sourceStem, displaySymbol,
      onPlate: '地盘', rawPalace: null, palace: null, palaceName: null, direction: null,
      states: {
        jiXing: false, jiXingDetail: null, ruMu: false, ruMuDetail: null,
        kongWangShi: false, kongWangRi: false, kongWangDetail: null,
      },
      note: note ?? `盘中未找到 ${sourceStem}`,
    };
  }
  const palaceObj = palaceMeta(chart, located.palace);
  const states = evaluateStates(chart, sourceStem, located);
  const finalNote = note ?? (located.onPlate === '地盘'
    ? '天盘未见此干，按地盘干定宫（击刑/入墓按天盘论，此为地盘参考位）'
    : null);
  return {
    role, birthStem, sourceStem, displaySymbol,
    onPlate: located.onPlate,
    rawPalace: located.rawPalace,
    palace: located.palace,
    palaceName: palaceObj ? palaceObj.name : null,
    direction: palaceObj ? palaceObj.direction : null,
    states,
    note: finalNote,
  };
}

function statesText(states: StemStates): string {
  const tags: string[] = [];
  if (states.jiXing) tags.push('击刑');
  if (states.ruMu) tags.push('入墓');
  if (states.kongWangShi || states.kongWangRi) tags.push('空亡');
  return tags.length > 0 ? tags.join('、') : '平安';
}

// ─── 盘面级不利状态检测 ───────────────────────────────────

/** 全盘六仪击刑 + 天盘干入墓清单（与用神无关，供解局总览） */
export function detectChartUnfavorable(chart: QimenChart): ChartUnfavorable {
  const jiXing: ChartUnfavorableItem[] = [];
  const ruMu: ChartUnfavorableItem[] = [];
  for (const p of chart.palaces) {
    if (p.isCenter || !p.skyStem) continue;
    const xingPalace = JI_XING_TABLE[p.skyStem];
    if (xingPalace !== undefined && xingPalace === p.palace) {
      jiXing.push({
        palace: p.palace, palaceName: p.name, direction: p.direction,
        skyStem: p.skyStem, earthStem: p.earthStem, reason: JI_XING_REASON[p.skyStem],
      });
    }
    const muPalace = RU_MU_TABLE[p.skyStem];
    if (muPalace !== undefined && muPalace === p.palace) {
      ruMu.push({
        palace: p.palace, palaceName: p.name, direction: p.direction,
        skyStem: p.skyStem, earthStem: p.earthStem, reason: RU_MU_REASON[p.skyStem],
      });
    }
  }
  return { jiXing, ruMu };
}

// ─── 用神定位主函数 ───────────────────────────────────────

/**
 * 在"当前时间起好的奇门盘"中，按出生八字定位本人/伴侣/生年用神并检测不利状态。
 * 全部为确定性计算，LLM 只引用 facts，严禁自行重定位。
 */
export function analyzePersonalSymbols(result: QimenFullResult, birth: BirthInput): PersonalAnalysis {
  const chart = result.chart;
  const [y, m, d] = birth.birthDate.split('-').map(Number);
  const hasTime = birth.birthTimeIndex !== undefined && birth.birthTimeIndex !== null;
  const hour = hasTime ? TIME_INDEX_TO_HOUR[birth.birthTimeIndex as number] : 12;

  const solar = Solar.fromYmdHms(y, m, d, hour, 0, 0);
  const lunar = solar.getLunar();

  // 八字日干支（Exact：晚子时 23:00 后按八字换日）与生年干支（Exact：立春边界）
  const dayGanZhi = lunar.getDayInGanZhiExact();
  const yearGanZhi = lunar.getYearInGanZhiExact();
  const dayStem = dayGanZhi[0];
  const yearStem = yearGanZhi[0];
  const hourLabel = hasTime ? SHI_CHEN_LABEL[birth.birthTimeIndex as number] : null;

  // ── 本人符号：出生日干（甲取出生旬首遁仪代理） ──
  let selfSourceStem = dayStem;
  let selfDisplay = dayStem;
  let selfNote: string | null = null;
  if (dayStem === '甲') {
    const dayXun = lunar.getDayXunExact();
    const proxy = XUNSHOU_TO_HIDDEN_YI[dayXun];
    selfSourceStem = proxy;
    selfDisplay = `${proxy}（代甲）`;
    selfNote = `八字日干为甲（不直接入盘），按出生旬首 ${dayXun} 取遁仪 ${proxy} 为其盘面代理`;
  }
  const self = buildPlacement(chart, '本人（八字日干）', dayStem, selfSourceStem, selfDisplay, selfNote);

  // ── 日干合神符号：本人符号的天干五合之干 ──
  const partnerStem = WU_HE_PARTNER[selfSourceStem];
  const partner = buildPlacement(
    chart,
    '日干合神（日干五合之干）',
    partnerStem,
    partnerStem,
    partnerStem,
    `${selfDisplay} 与 ${partnerStem} 天干五合（${selfSourceStem}${partnerStem}相合），${partnerStem} 为日干${selfSourceStem}之合神，五合古法取夫妇之配，主深度亲密关系缘分`,
  );

  // ── 生年干符号（财富/事业加看） ──
  let yearSymbol: PersonalAnalysis['yearSymbol'];
  if (yearStem === '甲') {
    const proxy = buildPlacement(
      chart, '生年干（盘面代理）', '甲', '戊', '戊（代甲）',
      '生年干为甲，奇门中以值符为其代表；另按通行做法取遁仪戊为其盘面代理以检测击刑/入墓状态',
    );
    const zhifuPalaceObj = palaceMeta(chart, chart.zhifu.palace);
    yearSymbol = {
      ...proxy,
      displaySymbol: `甲（以值符${chart.zhifu.star}为代表）`,
      zhifuProxy: {
        star: chart.zhifu.star,
        palace: chart.zhifu.palace,
        palaceName: zhifuPalaceObj ? zhifuPalaceObj.name : null,
        direction: zhifuPalaceObj ? zhifuPalaceObj.direction : null,
      },
    };
  } else {
    yearSymbol = {
      ...buildPlacement(chart, '生年干', yearStem, yearStem, yearStem, null),
      zhifuProxy: null,
    };
  }

  // ── 六合神落宫（感情参考） ──
  const liuhePalaceObj = chart.palaces.find((p) => p.god === '六合') ?? null;
  const liuhe = {
    palace: liuhePalaceObj ? liuhePalaceObj.palace : null,
    palaceName: liuhePalaceObj ? liuhePalaceObj.name : null,
    direction: liuhePalaceObj ? liuhePalaceObj.direction : null,
    kongWang: liuhePalaceObj
      ? chart.kongwangPalaces.includes(liuhePalaceObj.palace) || chart.dayKongwangPalaces.includes(liuhePalaceObj.palace)
      : false,
  };

  // ── 孤辰寡宿（年支亥子丑专用口诀） ──
  const yearZhi = yearGanZhi[1];
  let guGuaHint: string | null = null;
  if (yearZhi === '亥' || yearZhi === '子' || yearZhi === '丑') {
    guGuaHint = '生年支为亥/子/丑（属猪、属鼠、属牛）：按体系可在住宅东北方放"猪"摆件、西北方放"兔"摆件化解孤辰寡宿。';
  }

  // ── 镇压法触发检测：太阴/玄武与本我或伴侣符号同宫 ──
  const personalPalaces = [self.palace, partner?.palace ?? null].filter((x): x is number => x !== null);
  const suppressionTargets = chart.palaces.filter(
    (p) => (p.god === '太阴' || p.god === '玄武') && personalPalaces.includes(p.palace),
  );

  // ── 事实化结论 ──
  const birthLine = `${birth.birthDate}${hourLabel ? ` ${hourLabel}` : ''}`;
  const facts: string[] = [];
  facts.push(
    `【本人】出生 ${birthLine}，八字日柱 ${dayGanZhi}；本我符号「${self.displaySymbol}」落${self.palaceName ?? '?'}（${self.direction ?? '?'}，第${self.palace ?? '?'}宫，${self.onPlate}）【状态：${statesText(self.states)}】${self.states.jiXingDetail ? `（${self.states.jiXingDetail}）` : ''}${self.states.ruMuDetail ? `（${self.states.ruMuDetail}）` : ''}${self.states.kongWangDetail ? `（${self.states.kongWangDetail}）` : ''}`,
  );
  if (partner) {
    facts.push(
      `【日干合神】${partner.note ?? ''}；符号「${partner.displaySymbol}」落${partner.palaceName ?? '?'}（${partner.direction ?? '?'}，第${partner.palace ?? '?'}宫，${partner.onPlate}）【状态：${statesText(partner.states)}】${partner.states.jiXingDetail ? `（${partner.states.jiXingDetail}）` : ''}${partner.states.ruMuDetail ? `（${partner.states.ruMuDetail}）` : ''}${partner.states.kongWangDetail ? `（${partner.states.kongWangDetail}）` : ''}`,
    );
  }
  const yearStateText = statesText(yearSymbol.states);
  const zhifuPart = yearSymbol.zhifuProxy
    ? `值符「${yearSymbol.zhifuProxy.star}」落${yearSymbol.zhifuProxy.palaceName ?? '?'}（第${yearSymbol.zhifuProxy.palace}宫）；代理仪「${yearSymbol.sourceStem}」落${yearSymbol.palaceName}（第${yearSymbol.palace}宫，${yearSymbol.onPlate}）`
    : `符号「${yearSymbol.displaySymbol}」落${yearSymbol.palaceName}（第${yearSymbol.palace}宫，${yearSymbol.onPlate}）`;
  facts.push(
    `【生年干】生年干支 ${yearGanZhi}；${zhifuPart}【代理仪状态：${statesText(yearSymbol.states)}】${yearSymbol.states.jiXingDetail ? `（${yearSymbol.states.jiXingDetail}）` : ''}${yearSymbol.states.ruMuDetail ? `（${yearSymbol.states.ruMuDetail}）` : ''}${yearSymbol.states.kongWangDetail ? `（${yearSymbol.states.kongWangDetail}）` : ''}`,
  );
  facts.push(
    `【六合神】落${liuhe.palaceName ?? '?'}（第${liuhe.palace ?? '?'}宫）${liuhe.kongWang ? '【落空亡：互相喜欢却缺交往合作机会】' : '【不空】'}`,
  );

  // ── 已触发的化解手册条目 ──
  const remedyHints: string[] = [];
  if (detectChartUnfavorable(chart).jiXing.length > 0 || self.states.jiXing || partner?.states.jiXing || yearSymbol.states.jiXing) {
    remedyHints.push('击刑');
  }
  if (detectChartUnfavorable(chart).ruMu.length > 0 || self.states.ruMu || partner?.states.ruMu || yearSymbol.states.ruMu) {
    remedyHints.push('入墓');
  }
  if (self.states.kongWangShi || self.states.kongWangRi || partner?.states.kongWangShi || partner?.states.kongWangRi || yearSymbol.states.kongWangShi || yearSymbol.states.kongWangRi || liuhe.kongWang) {
    remedyHints.push('空亡');
  }
  if (suppressionTargets.length > 0) {
    remedyHints.push(
      `烂桃花/小人信号：${suppressionTargets.map((p) => `${p.god}（${p.name}第${p.palace}宫）`).join('、')}与本我或伴侣符号同宫，可按镇压法处理（偏财符号除外，不到万不得已不镇压）`,
    );
  }
  if (guGuaHint) {
    remedyHints.push('孤辰寡宿');
  }

  return {
    birth: { date: birth.birthDate, timeIndex: hasTime ? (birth.birthTimeIndex as number) : null, hourLabel },
    baZi: { dayGanZhi, yearGanZhi },
    self,
    partner,
    yearSymbol,
    liuhe,
    guGuaHint,
    facts,
    remedyHints,
  };
}
