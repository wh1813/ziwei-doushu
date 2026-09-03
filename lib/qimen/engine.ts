import { Solar } from 'lunar-javascript';
import type { ChartUnfavorable, PersonalAnalysis } from './remedy';

/**
 * 奇门遁甲 —— 确定性引擎层（时家转盘 · mainline-cn-v1）
 *
 * 算法来源：Numerologist_skills qimen-dunjia/scripts/qimen_cli.py 的忠实 TypeScript 移植，
 * 历法/干支/节气计算使用 lunar-javascript（与参考脚本 lunar_python 同源库族）。
 *
 * 职责边界（防幻觉核心）：
 *  1. 参数校验：要素缺失严禁强排
 *  2. 确定性排盘：阴阳遁/三元定局/地盘/天盘/九星/八门/八神/旬空/值符值使/格局全由代码计算
 *  3. Prompt 组装：LLM 只允许基于已算好的盘骨架做论述，严禁改盘
 *
 * 规则集固定项（mainline-cn-v1）：
 *  - 时家转盘奇门，按当前节令查固定定局表，每 5 日一元循环上/中/下元
 *  - 中宫相关判断一律寄坤处理
 *  - 值符值使同落时干所到之宫（不另做独立转门计算）
 *  - 天盘起点为旬首所遁之仪（代表甲），落中宫时寄坤取坤宫地盘干起排
 *
 * 本模块不发起任何网络请求，便于单测与复用。
 */

// ─── 常量表（与 qimen_cli.py 逐项一致） ─────────────────────

const JIAZI = [
  '甲子', '乙丑', '丙寅', '丁卯', '戊辰', '己巳', '庚午', '辛未', '壬申', '癸酉',
  '甲戌', '乙亥', '丙子', '丁丑', '戊寅', '己卯', '庚辰', '辛巳', '壬午', '癸未',
  '甲申', '乙酉', '丙戌', '丁亥', '戊子', '己丑', '庚寅', '辛卯', '壬辰', '癸巳',
  '甲午', '乙未', '丙申', '丁酉', '戊戌', '己亥', '庚子', '辛丑', '壬寅', '癸卯',
  '甲辰', '乙巳', '丙午', '丁未', '戊申', '己酉', '庚戌', '辛亥', '壬子', '癸丑',
  '甲寅', '乙卯', '丙辰', '丁巳', '戊午', '己未', '庚申', '辛酉', '壬戌', '癸亥',
];

const YANG_TERMS = new Set([
  '冬至', '小寒', '大寒', '立春', '雨水', '惊蛰',
  '春分', '清明', '谷雨', '立夏', '小满', '芒种',
]);

type Yuan = '上元' | '中元' | '下元';
type DunType = '阳遁' | '阴遁';

const JU_TABLE: Record<DunType, Record<string, Record<Yuan, number>>> = {
  阳遁: {
    冬至: { 上元: 1, 中元: 7, 下元: 4 },
    小寒: { 上元: 2, 中元: 8, 下元: 5 },
    大寒: { 上元: 3, 中元: 9, 下元: 6 },
    立春: { 上元: 8, 中元: 5, 下元: 2 },
    雨水: { 上元: 9, 中元: 6, 下元: 3 },
    惊蛰: { 上元: 1, 中元: 7, 下元: 4 },
    春分: { 上元: 3, 中元: 9, 下元: 6 },
    清明: { 上元: 4, 中元: 1, 下元: 7 },
    谷雨: { 上元: 5, 中元: 2, 下元: 8 },
    立夏: { 上元: 4, 中元: 1, 下元: 7 },
    小满: { 上元: 5, 中元: 2, 下元: 8 },
    芒种: { 上元: 6, 中元: 3, 下元: 9 },
  },
  阴遁: {
    夏至: { 上元: 9, 中元: 3, 下元: 6 },
    小暑: { 上元: 8, 中元: 2, 下元: 5 },
    大暑: { 上元: 7, 中元: 1, 下元: 4 },
    立秋: { 上元: 2, 中元: 5, 下元: 8 },
    处暑: { 上元: 1, 中元: 4, 下元: 7 },
    白露: { 上元: 9, 中元: 3, 下元: 6 },
    秋分: { 上元: 7, 中元: 1, 下元: 4 },
    寒露: { 上元: 6, 中元: 9, 下元: 3 },
    霜降: { 上元: 5, 中元: 8, 下元: 2 },
    立冬: { 上元: 6, 中元: 9, 下元: 3 },
    小雪: { 上元: 5, 中元: 8, 下元: 2 },
    大雪: { 上元: 4, 中元: 7, 下元: 1 },
  },
};

const EARTH_STEM_ORDER: Record<DunType, string[]> = {
  阳遁: ['戊', '己', '庚', '辛', '壬', '癸', '丁', '丙', '乙'],
  阴遁: ['戊', '乙', '丙', '丁', '癸', '壬', '辛', '庚', '己'],
};

// 八宫环形序列（不含中宫5），对应洛书九宫顺序（坎1→艮8→震3→巽4→离9→坤2→兑7→乾6）
const ROTATION_RING = [1, 8, 3, 4, 9, 2, 7, 6];

// 九星原始归属：天蓬→1坎, 天任→8艮, 天冲→3震, 天辅→4巽, 天英→9离, 天芮→2坤, 天柱→7兑, 天心→6乾
// 中宫天禽不在环中，寄坤时并入天芮
const STAR_RING = ['天蓬', '天任', '天冲', '天辅', '天英', '天芮', '天柱', '天心'];

// 八门原始归属：休门→1坎, 生门→8艮, 伤门→3震, 杜门→4巽, 景门→9离, 死门→2坤, 惊门→7兑, 开门→6乾
const DOOR_RING = ['休门', '生门', '伤门', '杜门', '景门', '死门', '惊门', '开门'];

// 八神：阳遁顺布，阴遁逆布；值符始终为第一位
const GOD_RING_YANG = ['值符', '螣蛇', '太阴', '六合', '白虎', '玄武', '九地', '九天'];
const GOD_RING_YIN = ['值符', '九天', '九地', '玄武', '白虎', '六合', '太阴', '螣蛇'];

export const XUNSHOU_TO_HIDDEN_YI: Record<string, string> = {
  甲子: '戊',
  甲戌: '己',
  甲申: '庚',
  甲午: '辛',
  甲辰: '壬',
  甲寅: '癸',
};

const BRANCH_TO_PALACE: Record<string, number> = {
  子: 1, 丑: 8, 寅: 8, 卯: 3, 辰: 4, 巳: 4,
  午: 9, 未: 2, 申: 2, 酉: 7, 戌: 6, 亥: 6,
};

const PALACE_INFO: Record<number, { name: string; direction: string; trigram: string; element: string }> = {
  1: { name: '坎宫', direction: '北', trigram: '坎', element: '水' },
  2: { name: '坤宫', direction: '西南', trigram: '坤', element: '土' },
  3: { name: '震宫', direction: '东', trigram: '震', element: '木' },
  4: { name: '巽宫', direction: '东南', trigram: '巽', element: '木' },
  5: { name: '中宫', direction: '中', trigram: '中', element: '土' },
  6: { name: '乾宫', direction: '西北', trigram: '乾', element: '金' },
  7: { name: '兑宫', direction: '西', trigram: '兑', element: '金' },
  8: { name: '艮宫', direction: '东北', trigram: '艮', element: '土' },
  9: { name: '离宫', direction: '南', trigram: '离', element: '火' },
};

// 洛书九宫展示顺序（左上4起，按行读：4-9-2 / 3-5-7 / 8-1-6）
export const GRID_ORDER = [4, 9, 2, 3, 5, 7, 8, 1, 6];

// 驿马表：申子辰日→驿马在寅, 寅午戌日→驿马在申, 亥卯未日→驿马在巳, 巳酉丑日→驿马在亥
const YIMA_TABLE: Record<string, string> = {
  申: '寅', 子: '寅', 辰: '寅',
  寅: '申', 午: '申', 戌: '申',
  亥: '巳', 卯: '巳', 未: '巳',
  巳: '亥', 酉: '亥', 丑: '亥',
};

const STEM_ELEMENT: Record<string, string> = {
  甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土',
  己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水',
};

// 生：木→火→土→金→水→木；克：木→土→水→火→金→木
const WUXING_SHENG: Record<string, string> = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' };
const WUXING_KE: Record<string, string> = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' };

const STAR_ELEMENT: Record<string, string> = {
  天蓬: '水', 天任: '土', 天冲: '木', 天辅: '木',
  天英: '火', 天芮: '土', 天柱: '金', 天心: '金', 天禽: '土',
};

const DOOR_ELEMENT: Record<string, string> = {
  休门: '水', 生门: '土', 伤门: '木', 杜门: '木',
  景门: '火', 死门: '土', 惊门: '金', 开门: '金',
};

const SAN_QI = new Set(['乙', '丙', '丁']);
const JI_MEN = new Set(['开门', '休门', '生门']);

// ─── 输入与校验 ───────────────────────────────────────────

export interface QimenInput {
  solarDate: string; // YYYY-MM-DD 阳历（按北京时间起局）
  timeIndex: number; // 0:早子(00:00) 1:丑(02:00) ... 11:亥(22:00) 12:晚子(23:00)
  questionType?: string;
  questionGoal?: string;
}

/** 时辰序号 → 代表性整点（同一时辰内时干支一致） */
export const TIME_INDEX_TO_HOUR: number[] = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 23];

/** 校验输入要素，缺少信息严禁强排。返回错误文案或 null。 */
export function validateQimenInput(p: {
  solarDate?: unknown;
  timeIndex?: unknown;
}): string | null {
  if (typeof p.solarDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.solarDate)) {
    return '请提供准确的起局日期（格式：YYYY-MM-DD）。';
  }
  const probe = new Date(`${p.solarDate}T00:00:00Z`);
  if (Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== p.solarDate) {
    return '起局日期无效，请核对年月日。';
  }
  const t = p.timeIndex;
  if (typeof t !== 'number' || !Number.isInteger(t) || t < 0 || t > 12) {
    return '请指定准确的起局时辰（0~12，其中 0 为早子时，12 为晚子时）。';
  }
  return null;
}

// ─── 排盘基础算子（与 qimen_cli.py 逐函数对应） ─────────────

function rotateToStart<T>(seq: T[], start: T): T[] {
  const idx = seq.indexOf(start);
  if (idx < 0) throw new Error(`序列中未找到元素: ${String(start)}`);
  return [...seq.slice(idx), ...seq.slice(0, idx)];
}

function splitBranchPair(text: string): string[] {
  return text.split('');
}

/** 日干支 → 三元：六十甲子序列每 5 日一元，循环上元/中元/下元 */
export function computeYuan(dayGanzhi: string): Yuan {
  const idx = JIAZI.indexOf(dayGanzhi);
  if (idx < 0) throw new Error(`无效日干支: ${dayGanzhi}`);
  return (['上元', '中元', '下元'] as const)[Math.floor(idx / 5) % 3];
}

/** 地盘：从局数宫起戊，按阴阳遁九干序排布 */
export function computeEarthPlate(dunType: DunType, juNumber: number): Record<number, string> {
  const palaces = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const rotated = rotateToStart(palaces, juNumber);
  const stems = EARTH_STEM_ORDER[dunType];
  const plate: Record<number, string> = {};
  rotated.forEach((palace, i) => {
    plate[palace] = stems[i];
  });
  return plate;
}

function findStemPalace(earthPlate: Record<number, string>, stem: string): number {
  for (const key of Object.keys(earthPlate)) {
    if (earthPlate[Number(key)] === stem) return Number(key);
  }
  throw new Error(`地盘中未找到天干 ${stem}`);
}

/** 中宫寄坤 */
function hostedPalace(palace: number): number {
  return palace === 5 ? 2 : palace;
}

/** 驿马：按日支三合局取驿马地支与宫位 */
function computeYima(dayZhi: string): { branch: string | null; palace: number | null } {
  const yimaBranch = YIMA_TABLE[dayZhi];
  if (!yimaBranch) return { branch: null, palace: null };
  return { branch: yimaBranch, palace: BRANCH_TO_PALACE[yimaBranch] ?? null };
}

/** 天盘干 vs 地盘干 五行生克 */
function computeStemRelation(skyStem: string | null, earthStem: string | null): string | null {
  if (!skyStem || !earthStem) return null;
  const skyElem = STEM_ELEMENT[skyStem];
  const earthElem = STEM_ELEMENT[earthStem];
  if (!skyElem || !earthElem) return null;
  if (skyElem === earthElem) return '比和';
  if (WUXING_SHENG[skyElem] === earthElem) return '天生地';
  if (WUXING_SHENG[earthElem] === skyElem) return '地生天';
  if (WUXING_KE[skyElem] === earthElem) return '天克地';
  if (WUXING_KE[earthElem] === skyElem) return '地克天';
  return null;
}

/** 通用五行关系：a 对 b */
function computeElementRelation(aElement: string | null | undefined, bElement: string | null | undefined): string | null {
  if (!aElement || !bElement) return null;
  if (aElement === bElement) return '比和';
  if (WUXING_SHENG[aElement] === bElement) return '生';
  if (WUXING_SHENG[bElement] === aElement) return '被生';
  if (WUXING_KE[aElement] === bElement) return '克';
  if (WUXING_KE[bElement] === aElement) return '被克';
  return null;
}

/** 查找某天干在地盘中的宫位（含寄坤处理） */
function findGanPalace(earthPlate: Record<number, string>, gan: string): {
  stem: string; rawPalace: number | null; palace: number | null; note: string | null;
} {
  for (const key of Object.keys(earthPlate)) {
    const palace = Number(key);
    if (earthPlate[palace] === gan) {
      return { stem: gan, rawPalace: palace, palace: hostedPalace(palace), note: null };
    }
  }
  return { stem: gan, rawPalace: null, palace: null, note: null };
}

// ─── 排盘结果结构 ─────────────────────────────────────────

export interface QimenPattern {
  name: string;
  palace: number;
  detail: string;
  nature: '吉' | '凶';
}

export interface QimenPalace {
  palace: number;
  name: string;
  direction: string;
  trigram: string;
  element: string;
  earthStem: string | null;
  skyStem: string | null;
  stemRelation: string | null;
  star: string | null;
  starElement: string | null;
  starPalaceRelation: string | null;
  door: string | null;
  doorElement: string | null;
  doorPalaceRelation: string | null;
  god: string | null;
  isCenter: boolean;
  hostsCenter: boolean;
  hostingNote: string | null;
}

export interface QimenChart {
  dunType: DunType;
  yuan: Yuan;
  juNumber: number;
  xunshou: string;
  hiddenYi: string;
  kongwang: string[];
  kongwangPalaces: number[];
  dayKongwang: string[];
  dayKongwangPalaces: number[];
  timeStemVisible: string;
  timePalace: number;
  xunshouPalace: number;
  dayStem: { stem: string; rawPalace: number | null; palace: number | null; note: string | null };
  yearStem: { stem: string; rawPalace: number | null; palace: number | null; note: string | null };
  monthStem: { stem: string; rawPalace: number | null; palace: number | null; note: string | null };
  yima: { branch: string | null; palace: number | null };
  zhifu: { star: string; palace: number };
  zhishi: { door: string; palace: number };
  doorIndex: Record<string, number>;
  starIndex: Record<string, number>;
  detectedPatterns: QimenPattern[];
  activeJie: string;
  warnings: string[];
  gridOrder: number[];
  palaces: QimenPalace[];
}

export interface QimenFullResult {
  input: {
    solarDate: string;
    timeIndex: number;
    hour: number;
    minute: number;
    questionType: string;
    questionGoal: string;
  };
  ganzhi: {
    year: string;
    month: string;
    day: string;
    time: string;
    dayXun: string;
    dayXunKong: string;
    timeXun: string;
    timeXunKong: string;
  };
  lunar: {
    year: number;
    month: number;
    day: number;
    monthText: string;
    dayText: string;
    isLeapMonth: boolean;
  };
  jieqi: {
    activeJie: string;
    activeJieAt: string;
    nextJie: string | null;
    nextJieAt: string | null;
  };
  chart: QimenChart;
}

/** 盘面常见格局检测（三奇配吉门/伏吟/反吟/门迫/值符得位） */
function detectPatterns(palaces: QimenPalace[], zhifu: { star: string; palace: number }): QimenPattern[] {
  const patterns: QimenPattern[] = [];

  for (const p of palaces) {
    if (p.isCenter) continue;
    const skyStem = p.skyStem;
    const earthStem = p.earthStem;
    const door = p.door;

    // 1. 三奇配吉门：天盘干为乙/丙/丁 且 门为开/休/生
    if (skyStem && SAN_QI.has(skyStem) && door && JI_MEN.has(door)) {
      patterns.push({ name: '三奇配吉门', palace: p.palace, detail: `${skyStem}+${door}`, nature: '吉' });
    }

    // 2. 伏吟：天盘干 == 地盘干（同干同宫）
    if (skyStem && earthStem && skyStem === earthStem) {
      patterns.push({ name: '伏吟', palace: p.palace, detail: `天地盘同为${skyStem}`, nature: '凶' });
    }

    // 3. 反吟：天地盘两干五行互克（对冲性质）
    if (skyStem && earthStem) {
      const skyElem = STEM_ELEMENT[skyStem];
      const earthElem = STEM_ELEMENT[earthStem];
      if (skyElem && earthElem && WUXING_KE[skyElem] === earthElem && WUXING_KE[earthElem] === skyElem) {
        patterns.push({
          name: '反吟',
          palace: p.palace,
          detail: `天${skyStem}(${skyElem})与地${earthStem}(${earthElem})互克`,
          nature: '凶',
        });
      }
    }

    // 4. 门迫：门的五行被所在宫的五行所克
    if (door) {
      const doorElem = DOOR_ELEMENT[door];
      if (doorElem && WUXING_KE[p.element] === doorElem) {
        patterns.push({
          name: '门迫',
          palace: p.palace,
          detail: `${door}(${doorElem})受${p.name}(${p.element})克`,
          nature: '凶',
        });
      }
    }
  }

  // 5. 值符得位：值符星落回其原始归属宫
  const starHome = new Map<string, number>(STAR_RING.map((s, i) => [s, ROTATION_RING[i]]));
  const zhifuHome = starHome.get(zhifu.star);
  if (zhifuHome !== undefined && zhifuHome === zhifu.palace) {
    patterns.push({ name: '值符得位', palace: zhifu.palace, detail: `${zhifu.star}回归本宫`, nature: '吉' });
  }

  return patterns;
}

function parseYmdHmsToUtcMs(text: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (!m) return null;
  return Date.UTC(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4]), Number(m[5]), Number(m[6]),
  );
}

// ─── 排盘核心（对应 qimen_cli.build_chart / build_output） ──

/** 服务端确定性排盘（时区固定按北京时间，与参考脚本默认一致）。失败抛错。 */
export function castQimenChart(input: QimenInput): QimenFullResult {
  const [y, m, d] = input.solarDate.split('-').map(Number);
  const hour = TIME_INDEX_TO_HOUR[input.timeIndex];
  const minute = 0;

  const solar = Solar.fromYmdHms(y, m, d, hour, minute, 0);
  const lunar = solar.getLunar();

  const warnings: string[] = [];

  // ── 节令与阴阳遁 ──
  const prevJie = lunar.getPrevJie();
  const nextJie = lunar.getNextJie();
  if (!prevJie) throw new Error('无法确定当前节令');
  const activeJie = prevJie.getName();
  const dunType: DunType = YANG_TERMS.has(activeJie) ? '阳遁' : '阴遁';

  // ── 三元与定局 ──
  const dayGanzhi = lunar.getDayInGanZhiExact();
  const yuan = computeYuan(dayGanzhi);
  const juNumber = JU_TABLE[dunType][activeJie][yuan];
  const earthPlate = computeEarthPlate(dunType, juNumber);

  // ── 时干支与旬首 ──
  const timeGanzhi = lunar.getTimeInGanZhi();
  const timeGan = timeGanzhi[0];
  const timeXun = lunar.getTimeXun();
  const timeXunKong = lunar.getTimeXunKong();
  const hiddenYi = XUNSHOU_TO_HIDDEN_YI[timeXun];
  if (!hiddenYi) throw new Error(`无法识别时旬首 ${timeXun}`);
  const visibleTimeGan = timeGan === '甲' ? hiddenYi : timeGan;
  if (timeGan === '甲') {
    warnings.push(`时干为甲，按旬首所遁之仪 ${hiddenYi} 入盘。`);
  }

  const xunshouRawPalace = findStemPalace(earthPlate, hiddenYi);
  const timeRawPalace = findStemPalace(earthPlate, visibleTimeGan);
  const xunshouPalace = hostedPalace(xunshouRawPalace);
  const timePalace = hostedPalace(timeRawPalace);

  if (xunshouRawPalace === 5 || timeRawPalace === 5) {
    warnings.push('本规则集中宫相关判断一律寄坤处理。');
  }

  // ── 转盘：阳遁顺布，阴遁逆布 ──
  let palaceOrder: number[];
  let starOrder: string[];
  let doorOrder: string[];
  let godOrder: string[];
  let outerEarth: string[];

  if (dunType === '阳遁') {
    palaceOrder = rotateToStart(ROTATION_RING, timePalace);
    starOrder = rotateToStart(STAR_RING, STAR_RING[ROTATION_RING.indexOf(xunshouPalace)]);
    doorOrder = rotateToStart(DOOR_RING, DOOR_RING[ROTATION_RING.indexOf(xunshouPalace)]);
    godOrder = GOD_RING_YANG;
    outerEarth = ROTATION_RING.map((p) => earthPlate[p]);
  } else {
    const reverseRing = [...ROTATION_RING].reverse();
    const reverseStarRing = [...STAR_RING].reverse();
    const reverseDoorRing = [...DOOR_RING].reverse();
    palaceOrder = rotateToStart(reverseRing, timePalace);
    starOrder = rotateToStart(reverseStarRing, STAR_RING[ROTATION_RING.indexOf(xunshouPalace)]);
    doorOrder = rotateToStart(reverseDoorRing, DOOR_RING[ROTATION_RING.indexOf(xunshouPalace)]);
    godOrder = GOD_RING_YIN;
    outerEarth = reverseRing.map((p) => earthPlate[p]);
  }

  // 天盘起点：旬首所遁之仪代表甲；其地盘落中宫(5)时寄坤，取坤宫地盘干起排
  const skyStartStem = xunshouRawPalace === 5 ? earthPlate[xunshouPalace] : hiddenYi;
  const skyOrder = rotateToStart(outerEarth, skyStartStem);

  const starMap = new Map<number, string>(palaceOrder.map((p, i) => [p, starOrder[i]]));
  const doorMap = new Map<number, string>(palaceOrder.map((p, i) => [p, doorOrder[i]]));
  const godMap = new Map<number, string>(palaceOrder.map((p, i) => [p, godOrder[i]]));
  const skyMap = new Map<number, string>(palaceOrder.map((p, i) => [p, skyOrder[i]]));

  const zhifu = { star: starMap.get(timePalace) as string, palace: timePalace };
  const zhishi = { door: doorMap.get(timePalace) as string, palace: timePalace };

  // ── 节气边界提醒（前后 24 小时内） ──
  const targetMs = Date.UTC(y, m - 1, d, hour, minute, 0);
  const jieMs = parseYmdHmsToUtcMs(prevJie.getSolar().toYmdHms());
  if (jieMs !== null && Math.abs(targetMs - jieMs) <= 24 * 3600 * 1000) {
    warnings.push('当前时间距离节令起点较近，属于节气边界附近。');
  }
  const nextJieAt = nextJie ? nextJie.getSolar().toYmdHms() : null;
  const nextJieMs = nextJieAt ? parseYmdHmsToUtcMs(nextJieAt) : null;
  if (nextJieMs !== null && Math.abs(nextJieMs - targetMs) <= 24 * 3600 * 1000) {
    warnings.push('当前时间距离下一个节令较近，属于节气边界附近。');
  }

  // ── 时空亡 / 日空亡 ──
  const kongwang = splitBranchPair(timeXunKong);
  const kongwangPalaces = [...new Set(kongwang.map((b) => BRANCH_TO_PALACE[b]).filter((x) => x !== undefined))].sort((a, b) => a - b);

  const dayXunKong = lunar.getDayXunKongExact();
  const dayKongwang = splitBranchPair(dayXunKong);
  const dayKongwangPalaces = [...new Set(dayKongwang.map((b) => BRANCH_TO_PALACE[b]).filter((x) => x !== undefined))].sort((a, b) => a - b);

  // ── 驿马（按日支三合局） ──
  const dayZhi = dayGanzhi[1];
  const yima = computeYima(dayZhi);

  // ── 日干落宫（甲不直接入盘，取日旬首所遁之仪） ──
  const dayGan = dayGanzhi[0];
  let dayStemInfo: { stem: string; rawPalace: number | null; palace: number | null; note: string | null };
  if (dayGan === '甲') {
    const dayXun = lunar.getDayXunExact();
    const dayHiddenYi = XUNSHOU_TO_HIDDEN_YI[dayXun];
    dayStemInfo = findGanPalace(earthPlate, dayHiddenYi);
    dayStemInfo.note = `日干为甲，取日旬首(${dayXun})所遁之仪 ${dayHiddenYi} 入盘`;
  } else {
    dayStemInfo = findGanPalace(earthPlate, dayGan);
    dayStemInfo.note = null;
  }

  // ── 年干 / 月干落宫（甲取戊代入） ──
  const yearGan = lunar.getYearInGanZhiExact()[0];
  let yearStemInfo: { stem: string; rawPalace: number | null; palace: number | null; note: string | null };
  if (yearGan === '甲') {
    yearStemInfo = findGanPalace(earthPlate, '戊');
    yearStemInfo.note = '年干为甲，取戊代入';
  } else {
    yearStemInfo = findGanPalace(earthPlate, yearGan);
    yearStemInfo.note = null;
  }

  const monthGan = lunar.getMonthInGanZhiExact()[0];
  let monthStemInfo: { stem: string; rawPalace: number | null; palace: number | null; note: string | null };
  if (monthGan === '甲') {
    monthStemInfo = findGanPalace(earthPlate, '戊');
    monthStemInfo.note = '月干为甲，取戊代入';
  } else {
    monthStemInfo = findGanPalace(earthPlate, monthGan);
    monthStemInfo.note = null;
  }

  // ── 九宫明细 ──
  const palaces: QimenPalace[] = [];
  for (let palaceNo = 1; palaceNo <= 9; palaceNo++) {
    const info = PALACE_INFO[palaceNo];
    const pEarth = earthPlate[palaceNo] ?? null;
    const pSky = skyMap.get(palaceNo) ?? null;
    const pStar = palaceNo === 5 ? '天禽' : starMap.get(palaceNo) ?? null;
    const pDoor = palaceNo === 5 ? null : doorMap.get(palaceNo) ?? null;
    const pGod = palaceNo === 5 ? null : godMap.get(palaceNo) ?? null;
    const pStarElem = pStar ? STAR_ELEMENT[pStar] ?? null : null;
    const pDoorElem = pDoor ? DOOR_ELEMENT[pDoor] ?? null : null;
    const palaceElem = info.element;
    palaces.push({
      palace: palaceNo,
      name: info.name,
      direction: info.direction,
      trigram: info.trigram,
      element: palaceElem,
      earthStem: pEarth,
      skyStem: pSky,
      stemRelation: computeStemRelation(pSky, pEarth),
      star: pStar,
      starElement: pStarElem,
      starPalaceRelation: computeElementRelation(pStarElem, palaceElem),
      door: pDoor,
      doorElement: pDoorElem,
      doorPalaceRelation: computeElementRelation(pDoorElem, palaceElem),
      god: pGod,
      isCenter: palaceNo === 5,
      hostsCenter: palaceNo === 2,
      hostingNote: palaceNo === 2 || palaceNo === 5 ? '中宫寄坤' : null,
    });
  }

  // ── 反查索引（门→宫, 星→宫，方便按用神快速定位） ──
  const doorIndex: Record<string, number> = {};
  const starIndex: Record<string, number> = {};
  for (const p of palaces) {
    if (p.door) doorIndex[p.door] = p.palace;
    if (p.star && !p.isCenter) starIndex[p.star] = p.palace;
  }

  // ── 格局自动检测 ──
  const detectedPatterns = detectPatterns(palaces, zhifu);

  const chart: QimenChart = {
    dunType,
    yuan,
    juNumber,
    xunshou: timeXun,
    hiddenYi,
    kongwang,
    kongwangPalaces,
    dayKongwang,
    dayKongwangPalaces,
    timeStemVisible: visibleTimeGan,
    timePalace,
    xunshouPalace,
    dayStem: dayStemInfo,
    yearStem: yearStemInfo,
    monthStem: monthStemInfo,
    yima,
    zhifu,
    zhishi,
    doorIndex,
    starIndex,
    detectedPatterns,
    activeJie,
    warnings,
    gridOrder: GRID_ORDER,
    palaces,
  };

  const lunarMonth = lunar.getMonth();
  return {
    input: {
      solarDate: input.solarDate,
      timeIndex: input.timeIndex,
      hour,
      minute,
      questionType: input.questionType ?? '',
      questionGoal: input.questionGoal ?? '',
    },
    ganzhi: {
      year: lunar.getYearInGanZhiExact(),
      month: lunar.getMonthInGanZhiExact(),
      day: dayGanzhi,
      time: timeGanzhi,
      dayXun: lunar.getDayXunExact(),
      dayXunKong,
      timeXun,
      timeXunKong,
    },
    lunar: {
      year: lunar.getYear(),
      month: Math.abs(lunarMonth),
      day: lunar.getDay(),
      monthText: lunar.getMonthInChinese(),
      dayText: lunar.getDayInChinese(),
      isLeapMonth: lunarMonth < 0,
    },
    jieqi: {
      activeJie,
      activeJieAt: prevJie.getSolar().toYmdHms(),
      nextJie: nextJie ? nextJie.getName() : null,
      nextJieAt,
    },
    chart,
  };
}

// ─── 盘面骨架提炼（省 Token、减干扰） ───────────────────────

export function extractChartSummary(result: QimenFullResult) {
  const chart = result.chart;
  const palaceOf = (no: number | null) =>
    no === null ? null : chart.palaces.find((p) => p.palace === no) ?? null;

  const timePalaceEntry = palaceOf(chart.timePalace);
  const dayPalaceEntry = palaceOf(chart.dayStem.palace);

  return {
    基本信息: {
      阴阳遁: chart.dunType,
      三元: chart.yuan,
      局数: chart.juNumber,
      当前节令: chart.activeJie,
      旬首: chart.xunshou,
      遁仪: chart.hiddenYi,
    },
    用神定位: {
      求测人日干: {
        干: chart.dayStem.stem,
        落宫: chart.dayStem.palace,
        宫位明细: dayPalaceEntry,
        说明: chart.dayStem.note,
      },
      所问之事时干: {
        干: chart.timeStemVisible,
        落宫: chart.timePalace,
        宫位明细: timePalaceEntry,
      },
      年干落宫: chart.yearStem,
      月干落宫: chart.monthStem,
      驿马: chart.yima,
    },
    值符值使: {
      值符星: chart.zhifu,
      值使门: chart.zhishi,
    },
    空亡: {
      时空亡: { 地支: chart.kongwang, 落宫: chart.kongwangPalaces },
      日空亡: { 地支: chart.dayKongwang, 落宫: chart.dayKongwangPalaces },
    },
    命中格局: chart.detectedPatterns,
    九宫明细: chart.palaces,
  };
}

// ─── 防幻觉 Prompt 组装 ───────────────────────────────────

export interface QimenPromptBundle {
  systemPrompt: string;
  userPrompt: string;
  chartContext: string; // 供日志记录的盘骨架摘要
}

/** 解盘附加预计算数据（可选注入）：个人用神定位 + 全盘不利状态清单 */
export interface QimenPromptExtras {
  personal?: PersonalAnalysis | null;
  chartUnfavorable?: ChartUnfavorable | null;
}

export function buildQimenPrompt(
  input: QimenInput,
  result: QimenFullResult,
  summary: ReturnType<typeof extractChartSummary>,
  extras?: QimenPromptExtras,
): QimenPromptBundle {
  const chart = result.chart;

  const systemPrompt = `
【身份定义】
你是一位严谨精通时家转盘奇门遁甲（置闰法+转盘、中宫寄坤二宫）的解盘与调理分析助手，遵循「荀爽体系」方法论。

【起局与用神总纲（体系铁律）】
1. 起局时间 = 当前时间（起心动念、想要预测或操作调理的那一刻），绝不是出生时间。本盘即由用户提供的当前时间起出。
2. 一事一局：同一件事在事态未发生实质变化期间不重复起局，以首次之局为准持续观察；换了新的事情才重新起局。
3. 排盘完成后，定位"代表个人的符号"时才使用出生八字（系统已预计算，见【个人用神定位】，若提供）：
   - 婚恋/情感调理：本人符号 = 出生日干（日干为甲者以出生旬首遁仪代理）；灵魂伴侣符号 = 日干的天干五合之干（甲己合、乙庚合、丙辛合、丁壬合、戊癸合）。
   - 财富/事业调理：在此之上加看生年干（生年干为甲者以值符为代表，另以遁仪戊为盘面代理）；须核查生年干符号在当前盘中是否击刑、入墓、空亡。

【系统刚性约束】
1. 严禁篡改盘面：阴阳遁、局数、天地盘干、九星、八门、八神、旬空、值符值使、格局、击刑/入墓清单、个人用神落宫均已由确定性排盘引擎算出，你只能基于下方预计算结果进行推导，严禁自行编造、重排或重新定位任何盘面要素。
2. 用神取用顺序（先主后辅，不堆砌）：
   - 求测者本人看日干落宫；所问之事、对方、当前动作看时干落宫。
   - 事业、工作、项目推进：主用神开门，辅助值符、日干。
   - 求财、交易、投资：主用神生门，辅助戊、日干；若提供个人用神，须叠加核查生年干符号状态。
   - 感情：男问女取乙，女问男取庚，同性关系取六合；若提供个人用神，须以"本人=出生日干、伴侣=日干五合干"为主轴解读。
   - 考试、学习、证书：主用神景门、天辅，辅助丁。
   - 疾病、健康：主用神天芮、死门，辅助日干；必须提醒奇门只看趋势，不代替就医检查。
   - 出行、方位、见人：主用神为目标方位所在宫，辅助开门、生门、值符。
   - 诉讼、合同、争议：主用神开门、惊门，辅助天心、值符。
   - 寻人、寻物：主用神时干加类象，辅助玄武、门的状态。
3. 格局判断顺序（不可颠倒）：
   - 先看主用神本身落宫好不好；再看值符、值使是否帮扶；再看门、星、神的组合；最后才看特殊格局名目。
   - 主用神已明显受制时，不要被个别"吉名"格局带偏。
4. 格局与吉凶象的翻译原则：
   - 三奇配吉门（乙丙丁配开休生门）：事情有转机，沟通、行动、资源调动更顺，适合推进、见人、签约。
   - 值符得位：主导权更稳，易得关键人物支持。
   - 门迫（门被宫克）：条件不顺，推进容易受卡，硬冲成本高。
   - 旬空：不直接等于坏，翻译成"力量虚、易落空拖延、需要等时机落地"。
   - 白虎重：提醒冲突、伤损、硬碰硬的代价；玄武重：提醒信息失真、反复、隐情、拖账。
   - 吉凶同现时，要说明"哪一块能做，哪一块先别做"。

【解局三大法门（处理击刑/入墓/空亡等不利符号的调理方法论）】
总顺序：先灭象、再布阵；换局为最终手段。
- 灭象：把制造不利映射的物品、行为、习惯从对应方位移除或移开。
- 布阵：在有利宫位对应方位放置符号物品，建立新的正向映射。
- 换局：灭象布阵后事态仍无改善，或确认起局本身有误（如时辰记录错误），才考虑重新起局；重申"一事一局"纪律，不得频繁换局。
具体手法与禁忌：
- 击刑（六仪落刑宫）：
  · 首选物理灭象：将该宫对应方位上、形象或用途与该天干对应的物品移走。
  · 相合化解：庚击刑可用乙之符号相合化解（乙庚合）；壬击刑（巽四宫）可用"酉"形象之物合辰化解。
  · 禁忌：严禁把代表健康的天干或其形象物品移入击刑宫。
- 入墓（天盘干落墓库宫）：
  · 禁忌：严禁把自身（本人用神符号）的物品放入入墓宫。
  · 财星/用神入墓：灭掉该宫的负面映射（清理杂物、旧物、破损品），并避免在该方位长期堆放对应物品。
- 空亡（用神落空宫）：
  · 填实法：在该空亡宫对应方位放置"空亡天干形象"的实物填实。
- 小人与烂桃花（镇压法）：
  · 当太阴/玄武（沐浴桃花类信号）与本我或伴侣符号同宫时，可将该符号对应的形象物品投入"入墓宫"或"空亡宫"对应方位镇压。
  · 红线：偏财符号不到万不得已绝不镇压。
- 孤辰寡宿（生年支为亥/子/丑）：
  · 在住宅东北方放"猪"摆件、西北方放"兔"摆件。

【安全红线】
1. 严禁断具体生死寿元；疾病健康类问题只做趋势提醒并明确建议就医检查。
2. 严禁绝对化宿命论断语；语气正向、给出路；不做医疗诊断与投资担保。
3. 调理建议仅限摆件挪移、方位取舍等象征性操作，不得替代医疗、法律、财务等专业意见，不得以"改运"名义诱导高风险消费或重大决定。
4. 引用预计算数据时必须与清单完全一致；发现清单疑似异常，如实说明并以盘面原文为准，不得擅自"修正"。

【确定性盘面骨架（由奇门排盘引擎计算导出）】
${JSON.stringify(summary, null, 2)}

【盘面附加说明】
- 本盘规则：${chart.dunType}${chart.juNumber}局（${chart.yuan}），节令${chart.activeJie}，旬首${chart.xunshou}（遁仪${chart.hiddenYi}）。
- ${chart.warnings.length > 0 ? chart.warnings.join(' ') : '本盘无特殊边界提醒。'}
`.trim();

  let fullSystem = systemPrompt;
  const uf = extras?.chartUnfavorable;
  if (uf) {
    const jiLine = uf.jiXing.length > 0
      ? uf.jiXing.map((i) => `第${i.palace}宫${i.palaceName}（${i.direction}）：天盘${i.skyStem}击刑 —— ${i.reason}`).join('；')
      : '无';
    const muLine = uf.ruMu.length > 0
      ? uf.ruMu.map((i) => `第${i.palace}宫${i.palaceName}（${i.direction}）：天盘${i.skyStem}入墓 —— ${i.reason}`).join('；')
      : '无';
    fullSystem += `\n\n【全盘不利状态清单（预计算，直接引用，严禁重查）】\n- 六仪击刑：${jiLine}\n- 天盘干入墓：${muLine}`;
  }
  if (extras?.personal) {
    fullSystem += `\n\n【个人用神定位（由出生八字预计算，直接引用，严禁重算落宫）】\nfacts 为已核实事实结论（逐条引用）；remedyHints 为已触发的化解手册条目（调理部分必须逐条给出可执行操作）：\n${JSON.stringify(extras.personal, null, 2)}`;
  }

  const typeText = input.questionType?.trim();
  const goalText = input.questionGoal?.trim();
  const askLine = goalText
    ? `求测事项：${typeText ? `【${typeText}】` : ''}${goalText}`
    : `求测事项：${typeText ? `【${typeText}】` : ''}请全面剖析此局对事业、财运、感情、健康方面的整体趋势与建议。`;

  const hasPersonal = Boolean(extras?.personal);
  const flowSteps = `解局流程（三步走，顺序不可颠倒）：
第一步·纯盘面解读：只依据当前时间起出的本盘盘面信息进行解读（阴阳遁/局数/天地盘干/九星/八门/八神/格局），此阶段不引入任何出生信息；
第二步·个人用神定位：${hasPersonal ? '系统已按出生八字锁定「本人=出生日干、伴侣=日干五合干、生年天干（甲以值符代甲并以遁仪戊为盘面代理）」，直接在九宫格中找到这些天干符号所在的宫位与方位，核查其平安/击刑/入墓/空亡状态' : '未提供出生信息，本步跳过，不得做任何个人层面的推断'}；
第三步·解局调理：在九宫格中定位需处理的宫位方位后，按「先灭象、再布阵、换局为最终手段」给出可执行调理动作。`;
  const userPrompt = `
${askLine}

${flowSteps}

请严格按以下八段结构化输出（保留相同的段落标题）：
1. 【已确认信息】复述所问事项与起局时间（公历日期、时辰、干支）${hasPersonal ? '；一并复述本机记忆的出生信息与八字日柱、生年干支' : ''}。
2. 【使用规则】说明本盘阴阳遁、局数、三元、旬首；若涉中宫寄坤或节气边界，此处明确提示；点明"起局用当前时间、第一步只看盘面、定位个人符号才用出生八字"的口径。
3. 【盘面摘要】仅基于当前盘面（不掺任何个人信息）概述值符、值使、时空亡与日空亡、驿马与关键宫位要素，让用户一眼看懂盘面大势。
4. 【用神与关键依据】明确本次主用神取什么、为何这样取、落在哪一宫；该宫的门、星、神是帮它还是压它。${hasPersonal ? '须在九宫格中逐一指认本人/伴侣/生年天干符号所在宫位与方位，并引用预计算的击刑/入墓/空亡状态。' : ''}
5. 【核心判断】对所问事项给出直接研判：成与不成、快与慢、利与不利；必须引用盘面证据${hasPersonal ? '与个人用神预计算事实' : ''}，禁止脱离盘面空谈。
6. 【方位时机建议】给出有利方位与行动时机建议（结合驿马、空亡、吉门所在宫位方向）。
7. 【解局与调理建议】对照预计算的不利清单（击刑/入墓/空亡/烂桃花小人/孤辰寡宿），按"先灭象、再布阵"逐条给出可执行的调理操作与禁忌；若全部平安，明确说明本局无需调理动作。
8. 【风险提醒】列出需要警惕的凶象（门迫、伏吟、反吟、空亡、白虎玄武等），并翻译成可执行的规避建议；重申安全红线。
`.trim();

  // 供 provider 层作为"程序已算好的盘面上下文"注入（provider 会自带"不得自行改盘"约束）
  const chartContext = JSON.stringify(summary, null, 2);

  return { systemPrompt: fullSystem, userPrompt, chartContext };
}
