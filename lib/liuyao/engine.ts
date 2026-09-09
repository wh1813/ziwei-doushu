/**
 * 六爻（周易）— 确定性起卦引擎（liuyao · mainline-cn-v1）
 *
 * 算法要点（古法金钱卦 + 京房纳甲体系）：
 * 1. 输入：起卦时间（公历日期 + 时辰 0-11）+ 起卦方式（manual / time / number）+ 手动六爻值（手动起卦时）
 * 2. 排卦步骤：
 *    - 取起卦时四柱（年/月/日/时干支，依赖 lunar-javascript）
 *    - 京房纳甲：八纯卦每爻纳上天干与地支（乾纳甲壬、坤纳乙癸、震纳庚、巽纳辛、坎纳戊、离纳己、艮纳丙、兑纳丁）
 *    - 装六亲（按卦所属宫五行与世爻五行定父母/兄弟/子孙/妻财/官鬼）
 *    - 装六兽（青龙/朱雀/勾陈/螣蛇/白虎/玄武，按日起）
 *    - 排世爻、应爻（本卦/变卦）
 *    - 标记动爻（变化之爻），生成变卦
 * 3. 输入校验：起卦方式为 manual 时必须提供六爻阴阳值；time/number 时由起卦时间 + 数字取爻
 * 4. 输出：完整卦象 JSON（前后卦、纳甲、六亲、六兽、世应、动爻、用神），LLM 解读的唯一输入
 *
 * 防幻觉核心：LLM 只能引用【确定性盘面骨架】内的字段，不得自行编造爻位、纳甲地支或六亲关系。
 *
 * 历法：依赖 lunar-javascript（与 lib/ziwei 同源库族）。
 *
 * 范围：R18-2 仅实现"时间起卦 + 数字起卦"两种；"手动爻"模式作为接口预留但暂不实现前端 UI。
 */

import { Solar } from 'lunar-javascript';
import { analyzeLiuyao, type AnalysisResult } from './analysis';

// ─── 八经卦基本参数（京房纳甲体系）────────────────

/** 八卦纳甲表（爻位由下而上 1-6） */
const NAI_JIA_TABLE: Record<string, { gan: string[]; zhi: string[] }> = {
  // 天干：内卦三爻与外卦三爻各纳一干（乾内甲外壬、坤内乙外癸；其余六卦内外同干）
  乾: { gan: ['甲', '甲', '甲', '壬', '壬', '壬'], zhi: ['子', '寅', '辰', '午', '申', '戌'] },
  坤: { gan: ['乙', '乙', '乙', '癸', '癸', '癸'], zhi: ['未', '巳', '卯', '丑', '亥', '酉'] },
  震: { gan: ['庚', '庚', '庚', '庚', '庚', '庚'], zhi: ['子', '寅', '辰', '午', '申', '戌'] },
  巽: { gan: ['辛', '辛', '辛', '辛', '辛', '辛'], zhi: ['丑', '亥', '酉', '未', '巳', '卯'] },
  坎: { gan: ['戊', '戊', '戊', '戊', '戊', '戊'], zhi: ['寅', '辰', '午', '申', '戌', '子'] },
  离: { gan: ['己', '己', '己', '己', '己', '己'], zhi: ['卯', '丑', '亥', '酉', '未', '巳'] },
  艮: { gan: ['丙', '丙', '丙', '丙', '丙', '丙'], zhi: ['辰', '午', '申', '戌', '子', '寅'] },
  兑: { gan: ['丁', '丁', '丁', '丁', '丁', '丁'], zhi: ['巳', '卯', '丑', '亥', '酉', '未'] },
};

/** 八卦五行：乾兑金、震巽木、坎水、离火、艮坤土 */
const TRIGRAM_WUXING: Record<string, string> = {
  乾: '金', 兑: '金',
  震: '木', 巽: '木',
  坎: '水', 离: '火',
  艮: '土', 坤: '土',
};

/** 六亲名：父母/兄弟/子孙/妻财/官鬼（按我克者为财、克我者为官、我生者为子孙、生我者为父母、同我者为兄弟） */
const LIUQIN_RELATIONS = ['父母', '兄弟', '子孙', '妻财', '官鬼'] as const;
type Liuqin = (typeof LIUQIN_RELATIONS)[number];

/** 地支五行（与奇门 engine 共用） */
const DIZHI_WUXING: Record<string, string> = {
  子: '水', 亥: '水',
  寅: '木', 卯: '木',
  巳: '火', 午: '火',
  申: '金', 酉: '金',
  辰: '土', 戌: '土', 丑: '土', 未: '土',
};

/** 天干五行 */
const TIANGAN_WUXING: Record<string, string> = {
  甲: '木', 乙: '木',
  丙: '火', 丁: '火',
  戊: '土', 己: '土',
  庚: '金', 辛: '金',
  壬: '水', 癸: '水',
};

/** 五行相生：木→火→土→金→水→木 */
const WUXING_SHENG: Record<string, string> = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' };
/** 五行相克：木→土→水→火→金→木 */
const WUXING_KE: Record<string, string> = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' };

/** 六兽（按日起，初爻起青龙） */
const LIUSHOU = ['青龙', '朱雀', '勾陈', '螣蛇', '白虎', '玄武'] as const;
type Liushou = (typeof LIUSHOU)[number];

/**
 * 经卦位图 → 卦名。
 *
 * 位序约定：bits 为「上爻、中爻、下爻」三字符（与 trigramsFromYaos 产出一致）。
 * 八卦爻形（自下而上 1=阳）：乾111 兑110 离101 震100 巽011 坎010 艮001 坤000，
 * 反转为「上中下」序即下表。位序搞错会使 8 个经卦中 6 个判错，进而连累卦名、
 * 卦宫、世爻与六亲，故以注释固定约定。
 */
const TRIGRAM_NAMES: Record<string, string> = {
  '111': '乾', '011': '兑', '101': '离', '001': '震',
  '110': '巽', '010': '坎', '100': '艮', '000': '坤',
};

/**
 * 先天八卦数（1-8）→ 经卦位图（「上中下」序，与 TRIGRAM_NAMES 同序）。
 * 用于时间起卦 / 数字起卦：卦数须整体映射为一个经卦三爻，
 * 不可用卦数奇偶逐爻填充（那样只能产出乾/坤两种卦）。
 */
const XIANTIAN_BITS: string[] = ['', '111', '011', '101', '001', '110', '010', '100', '000'];

/** 由上下卦数（1-8，先天数）生成 6 爻阴阳（自下而上） */
function yaosFromGuaNumbers(upperNum: number, lowerNum: number): boolean[] {
  const up = XIANTIAN_BITS[upperNum] || '000';
  const lo = XIANTIAN_BITS[lowerNum] || '000';
  // bits=[上,中,下]；下卦取初/二/三爻 = lo[2]/lo[1]/lo[0]，上卦取四/五/六爻同理
  return [
    lo[2] === '1', lo[1] === '1', lo[0] === '1',
    up[2] === '1', up[1] === '1', up[0] === '1',
  ];
}

/** 64 卦全名（按上下卦组合 → 卦名） */
const HEXAGRAM_NAMES: Record<string, string> = {
  '乾乾': '乾为天', '乾坤': '天地否', '乾震': '天雷无妄', '乾巽': '天风姤',
  '乾坎': '天水讼', '乾离': '天火同人', '乾艮': '天山遁', '乾兑': '天泽履',
  '坤乾': '地天泰', '坤坤': '坤为地', '坤震': '地雷复', '坤巽': '地风升',
  '坤坎': '地水师', '坤离': '地火明夷', '坤艮': '地山谦', '坤兑': '地泽临',
  '震乾': '雷天大壮', '震坤': '雷地豫', '震震': '震为雷', '震巽': '雷风恒',
  '震坎': '雷水解', '震离': '雷火丰', '震艮': '雷山小过', '震兑': '雷泽归妹',
  '巽乾': '风天小畜', '巽坤': '风地观', '巽震': '风雷益', '巽巽': '巽为风',
  '巽坎': '风水涣', '巽离': '风火家人', '巽艮': '风山渐', '巽兑': '风泽中孚',
  '坎乾': '水天需', '坎坤': '水地比', '坎震': '水雷屯', '坎巽': '水风井',
  '坎坎': '坎为水', '坎离': '水火既济', '坎艮': '水山蹇', '坎兑': '水泽节',
  '离乾': '火天大有', '离坤': '火地晋', '离震': '火雷噬嗑', '离巽': '火风鼎',
  '离坎': '火水未济', '离离': '离为火', '离艮': '火山旅', '离兑': '火泽睽',
  '艮乾': '山天大畜', '艮坤': '山地剥', '艮震': '山雷颐', '艮巽': '山风蛊',
  '艮坎': '山水蒙', '艮离': '山火贲', '艮艮': '艮为山', '艮兑': '山泽损',
  '兑乾': '泽天夬', '兑坤': '泽地萃', '兑震': '泽雷随', '兑巽': '泽风大过',
  '兑坎': '泽水困', '兑离': '泽火革', '兑艮': '泽山咸', '兑兑': '兑为泽',
};

// ─── 类型 ──────────────────────────────────────────

export interface LiuyaoInput {
  solarDate: string;          // YYYY-MM-DD
  timeIndex: number;          // 0-11（12 时辰）
  questionType: string;
  questionGoal: string;
  method: 'time' | 'number' | 'manual';
  /** 手动起卦：6 个爻的阴阳值，true=阳爻，false=阴爻（仅 method=manual） */
  manualYao?: boolean[];
  /** 数字起卦：可选的两个数字（1-999），用于"上下卦数 + 动爻数"（仅 method=number） */
  numberA?: number;
  numberB?: number;
  /** 用户性别（用于装六亲时辅助取用神） */
  gender?: '男' | '女' | '不指定';
}

export interface LiuyaoYao {
  position: number;           // 1-6（1=初爻在最下，6=上爻在最上）
  yinYang: '阳' | '阴';
  gan: string;                // 纳甲天干
  zhi: string;                // 纳甲地支
  zhiWuxing: string;          // 地支五行
  liuqin: Liuqin;             // 六亲
  liushou: Liushou;           // 六兽
  isShi: boolean;             // 是否世爻
  isYing: boolean;            // 是否应爻
  isDong: boolean;            // 是否动爻
  bianYinYang?: '阳' | '阴';  // 变爻阴阳（仅动爻有）
  bianGan?: string;           // 变爻纳甲天干
  bianZhi?: string;           // 变爻纳甲地支
}

export interface LiuyaoChart {
  benGua: string;             // 本卦名（如"乾为天"）
  benUpperTrigram: string;    // 上卦名
  benLowerTrigram: string;    // 下卦名
  bianGua: string;            // 变卦名
  bianUpperTrigram: string;   // 变卦上卦
  bianLowerTrigram: string;   // 变卦下卦
  dongYaoIndices: number[];   // 动爻位置 1-6
  shiYaoIndex: number;        // 世爻位置 1-6
  yingYaoIndex: number;       // 应爻位置 1-6
  guaGong: string;            // 本卦所属宫（八宫：金木水火土四墓四绝）
  guaGongWuxing: string;      // 宫五行
  liuqinOfSelf: Liuqin;       // 世爻六亲（即"卦主"）
  yaoList: LiuyaoYao[];       // 六爻明细（按 position 1-6 升序）
}

export interface LiuyaoFullResult {
  input: LiuyaoInput;
  ganzhi: {
    year: string;             // 起卦年干支
    month: string;            // 起卦月干支
    day: string;              // 起卦日干支
    time: string;             // 起卦时干支
  };
  chart: LiuyaoChart;
  /** 用神推算（基于问事类型 + 性别） */
  yongShen: {
    name: string;             // 用神名（如"妻财午火"）
    reason: string;           // 推算理由
    position: number | null;  // 用神所在爻位（1-6）；无动爻命中时 null
  };
  /** 命中格局（空亡、月破、六合、六冲、三刑、进退神、回头生克 等） */
  detectedPatterns: Array<{ name: string; nature: '吉' | '凶' | '中性'; note: string }>;
  /** 深度分析（旺衰 / 日辰作用 / 五神 / 伏神 / 应期 / 间爻） */
  analysis: AnalysisResult;
  warnings: string[];         // 边界提醒
}

// ─── 工具函数 ─────────────────────────────────────

/** 6 个爻的阴阳值（true=阳）→ 上/下卦三爻二进制串 */
function trigramsFromYaos(yaos: boolean[]): { upper: string; lower: string } {
  // 上卦 = 第 6/5/4 爻（高位），下卦 = 第 3/2/1 爻（低位）
  const lower = (yaos[2] ? '1' : '0') + (yaos[1] ? '1' : '0') + (yaos[0] ? '1' : '0');
  const upper = (yaos[5] ? '1' : '0') + (yaos[4] ? '1' : '0') + (yaos[3] ? '1' : '0');
  return { upper, lower };
}

function trigramName(bits: string): string {
  return TRIGRAM_NAMES[bits] || '未知';
}

function hexagramName(upper: string, lower: string): string {
  return HEXAGRAM_NAMES[`${upper}${lower}`] || `${upper}${lower}卦`;
}

/** 起卦时间 → 六爻阴阳（金钱卦：3 枚铜钱抛 6 次，时间起卦固定 6 次） */
function yaosFromTime(solar: Solar): { yaos: boolean[]; dongIndices: number[] } {
  // 时间起卦：用"年月日时"地支数确定上卦下卦与动爻
  // 上卦数 = (年+月+日) % 8（0 视为 8）
  // 下卦数 = (年+月+日+时) % 8
  // 动爻数 = (年+月+日+时) % 6（0 视为 6）
  // 注意：Lunar d.ts 中无 getTimeZhi()，从 getTimeInGanZhi() 末位取地支
  const ba = solar.getLunar();
  const yearZhiIdx = getZhiIndex(ba.getYearZhi());
  const monthZhiIdx = getZhiIndex(ba.getMonthZhi());
  const dayZhiIdx = getZhiIndex(ba.getDayZhi());
  const timeZhiIdx = getZhiIndex(ba.getTimeInGanZhi().slice(-1));

  const upperNum = (yearZhiIdx + monthZhiIdx + dayZhiIdx) % 8 || 8;
  const lowerNum = (yearZhiIdx + monthZhiIdx + dayZhiIdx + timeZhiIdx) % 8 || 8;
  const dongNum = (yearZhiIdx + monthZhiIdx + dayZhiIdx + timeZhiIdx) % 6 || 6;

  return { yaos: yaosFromGuaNumbers(upperNum, lowerNum), dongIndices: [dongNum] };
}

/** 数字起卦（如 123 → 上下卦 1+2+3=6，1+2+3=6，动爻 6） */
function yaosFromNumber(a: number, b: number): { yaos: boolean[]; dongIndices: number[] } {
  const total = a + b;
  const upperNum = total % 8 || 8;
  // 下卦取两数之与时辰之外的独立来源：上卦用和、下卦用首数，避免上下卦恒等
  const lowerNum = (a % 8) || 8;
  const dongNum = (total % 6) || 6;
  return { yaos: yaosFromGuaNumbers(upperNum, lowerNum), dongIndices: [dongNum] };
}

const ZHI_LIST = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
function getZhiIndex(zhi: string): number {
  const i = ZHI_LIST.indexOf(zhi);
  return i >= 0 ? i : 0;
}

/** 由卦象查所属宫（简化版：八纯卦各归本宫，64 卦其余用京房八宫世应定位） */
/**
 * 京房八宫六十四卦归属表（卦名 → 宫名）。
 *
 * 八宫各领八卦：本宫纯卦(世在六) → 一世至五世(世在一至五) → 游魂(世在四) → 归魂(世在六/三)。
 * 卦宫五行决定该卦全部六爻的六亲，是排盘正确性的地基——宫判错则六亲全错。
 *
 * 顺序（每宫 8 卦）：纯卦、一世、二世、三世、四世、五世、游魂、归魂
 */
export const GONG_TABLE: Record<string, { gong: string; shi: number }> = {
  // 乾宫（金）
  '乾为天': { gong: '乾宫', shi: 6 }, '天风姤': { gong: '乾宫', shi: 1 },
  '天山遁': { gong: '乾宫', shi: 2 }, '天地否': { gong: '乾宫', shi: 3 },
  '风地观': { gong: '乾宫', shi: 4 }, '山地剥': { gong: '乾宫', shi: 5 },
  '火地晋': { gong: '乾宫', shi: 4 }, '火天大有': { gong: '乾宫', shi: 3 },
  // 兑宫（金）
  '兑为泽': { gong: '兑宫', shi: 6 }, '泽水困': { gong: '兑宫', shi: 1 },
  '泽地萃': { gong: '兑宫', shi: 2 }, '泽山咸': { gong: '兑宫', shi: 3 },
  '水山蹇': { gong: '兑宫', shi: 4 }, '地山谦': { gong: '兑宫', shi: 5 },
  '雷山小过': { gong: '兑宫', shi: 4 }, '雷泽归妹': { gong: '兑宫', shi: 3 },
  // 离宫（火）
  '离为火': { gong: '离宫', shi: 6 }, '火山旅': { gong: '离宫', shi: 1 },
  '火风鼎': { gong: '离宫', shi: 2 }, '火水未济': { gong: '离宫', shi: 3 },
  '山水蒙': { gong: '离宫', shi: 4 }, '风水涣': { gong: '离宫', shi: 5 },
  '天水讼': { gong: '离宫', shi: 4 }, '天火同人': { gong: '离宫', shi: 3 },
  // 震宫（木）
  '震为雷': { gong: '震宫', shi: 6 }, '雷地豫': { gong: '震宫', shi: 1 },
  '雷水解': { gong: '震宫', shi: 2 }, '雷风恒': { gong: '震宫', shi: 3 },
  '地风升': { gong: '震宫', shi: 4 }, '水风井': { gong: '震宫', shi: 5 },
  '泽风大过': { gong: '震宫', shi: 4 }, '泽雷随': { gong: '震宫', shi: 3 },
  // 巽宫（木）
  '巽为风': { gong: '巽宫', shi: 6 }, '风天小畜': { gong: '巽宫', shi: 1 },
  '风火家人': { gong: '巽宫', shi: 2 }, '风雷益': { gong: '巽宫', shi: 3 },
  '天雷无妄': { gong: '巽宫', shi: 4 }, '火雷噬嗑': { gong: '巽宫', shi: 5 },
  '山雷颐': { gong: '巽宫', shi: 4 }, '山风蛊': { gong: '巽宫', shi: 3 },
  // 坎宫（水）
  '坎为水': { gong: '坎宫', shi: 6 }, '水泽节': { gong: '坎宫', shi: 1 },
  '水雷屯': { gong: '坎宫', shi: 2 }, '水火既济': { gong: '坎宫', shi: 3 },
  '泽火革': { gong: '坎宫', shi: 4 }, '雷火丰': { gong: '坎宫', shi: 5 },
  '地火明夷': { gong: '坎宫', shi: 4 }, '地水师': { gong: '坎宫', shi: 3 },
  // 艮宫（土）
  '艮为山': { gong: '艮宫', shi: 6 }, '山火贲': { gong: '艮宫', shi: 1 },
  '山天大畜': { gong: '艮宫', shi: 2 }, '山泽损': { gong: '艮宫', shi: 3 },
  '火泽睽': { gong: '艮宫', shi: 4 }, '天泽履': { gong: '艮宫', shi: 5 },
  '风泽中孚': { gong: '艮宫', shi: 4 }, '风山渐': { gong: '艮宫', shi: 3 },
  // 坤宫（土）
  '坤为地': { gong: '坤宫', shi: 6 }, '地雷复': { gong: '坤宫', shi: 1 },
  '地泽临': { gong: '坤宫', shi: 2 }, '地天泰': { gong: '坤宫', shi: 3 },
  '雷天大壮': { gong: '坤宫', shi: 4 }, '泽天夬': { gong: '坤宫', shi: 5 },
  '水天需': { gong: '坤宫', shi: 4 }, '水地比': { gong: '坤宫', shi: 3 },
};

/** 卦名 → 宫名（由 GONG_TABLE 派生，避免宫表与世爻表两处维护不一致） */
export const HEX_GONG_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(GONG_TABLE).map(([k, v]) => [k, v.gong]),
);

/** 八宫五行（卦宫五行决定六亲，非卦象五行） */
export const GONG_WUXING: Record<string, string> = {
  乾宫: '金', 兑宫: '金',
  离宫: '火',
  震宫: '木', 巽宫: '木',
  坎宫: '水',
  艮宫: '土', 坤宫: '土',
};

function guaGongByName(hexName: string): string {
  return HEX_GONG_MAP[hexName] || '杂卦';
}

/**
 * 世爻位置（京房八宫安世法）。
 * 本宫纯卦世在六；一世至五世依次在初至五；游魂世在四；归魂世在三。
 * 单一真相源为 GONG_TABLE，此处不另立世爻表，避免两表不一致。
 */
function shiYaoPosition(hexName: string): number {
  return GONG_TABLE[hexName]?.shi ?? 3;
}

/** 应爻位置：与世爻相隔两爻（世 1→应 4、6→应 3 等） */
function yingYaoPosition(shi: number): number {
  // 应爻与世爻"隔二位"
  const map: Record<number, number> = { 1: 4, 2: 5, 3: 6, 4: 1, 5: 2, 6: 3 };
  return map[shi] || 4;
}

/** 计算六亲：按"卦宫五行"与"爻地支五行"的生克关系定 */
function computeLiuqin(gongWuxing: string, zhiWuxing: string): Liuqin {
  if (gongWuxing === zhiWuxing) return '兄弟';
  if (WUXING_SHENG[gongWuxing] === zhiWuxing) return '子孙';
  if (WUXING_KE[gongWuxing] === zhiWuxing) return '妻财';
  if (WUXING_SHENG[zhiWuxing] === gongWuxing) return '父母';
  if (WUXING_KE[zhiWuxing] === gongWuxing) return '官鬼';
  return '兄弟';
}

/** 装六兽（按日起：日支子午卯酉起青龙） */
const SHEN_START: Record<string, number> = {
  子: 0, 午: 0, 卯: 0, 酉: 0,    // 初爻起青龙
  寅: 1, 申: 1, 巳: 1, 亥: 1,    // 初爻起朱雀
  辰: 2, 戌: 2,                  // 初爻起勾陈
  丑: 3, 未: 3,                  // 初爻起螣蛇
};

function liushouByDay(dayZhi: string): Liushou[] {
  // 返回 6 个爻（自下而上 1-6）的六兽
  const startIdx = SHEN_START[dayZhi] ?? 0;
  const arr: Liushou[] = [];
  for (let i = 0; i < 6; i++) {
    const idx = (startIdx + i) % 6;
    arr.push(LIUSHOU[idx]);
  }
  return arr;
}

/** 用神取用（按问题类型 + 性别） */
function yongShenForQuestion(
  questionType: string,
  liuqinOfShi: Liuqin,
  gender: '男' | '女' | '不指定',
): { name: string; reason: string } {
  const type = (questionType || '').trim();
  // 卦主六亲决定"我"是谁；用神按"事类"取对应六亲
  if (type.includes('财') || type.includes('交易') || type.includes('投资') || type.includes('求财')) {
    return { name: '妻财', reason: '求财/交易类问事，以妻财爻为用神（不论卦主六亲）' };
  }
  if (type.includes('官') || type.includes('事业') || type.includes('工作') || type.includes('求职') || type.includes('诉讼')) {
    return { name: '官鬼', reason: '事业/工作/官非类问事，以官鬼爻为用神' };
  }
  if (type.includes('父') || type.includes('文') || type.includes('考试') || type.includes('文书') || type.includes('合同')) {
    return { name: '父母', reason: '文书/考试/合同类问事，以父母爻为用神' };
  }
  if (type.includes('子') || type.includes('健康') || type.includes('病') || type.includes('忧') || type.includes('脱')) {
    return { name: '子孙', reason: '健康/脱困/忧虑类问事，以子孙爻为用神（子孙为福德，制官鬼解忧）' };
  }
  if (type.includes('感情') || type.includes('婚') || type.includes('恋') || type.includes('桃花')) {
    return gender === '男' ? { name: '妻财', reason: '男问婚恋，以妻财爻为用神' } : { name: '官鬼', reason: '女问婚恋，以官鬼爻为用神' };
  }
  // 兜底：按卦主六亲为"我"反推
  const map: Record<Liuqin, string> = {
    父母: '父母（身爻/学业文契）',
    兄弟: '兄弟（合伙/同事/竞争）',
    子孙: '子孙（福德/健康/脱困）',
    妻财: '妻财（财/物/男婚）',
    官鬼: '官鬼（事业/女婚/官非）',
  };
  return { name: map[liuqinOfShi], reason: '未明确问事项，按卦主六亲作为用神主轴' };
}

/** 检测空亡：日柱旬空（旬内十干配完，余下两地支为空） */
const TIAN_GAN_ORDER = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const DI_ZHI_ORDER = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

/** 60 甲子表（索引 0=甲子 … 59=癸亥） */
const JIA_ZI: string[] = (() => {
  const arr: string[] = [];
  for (let i = 0; i < 60; i++) {
    arr.push(TIAN_GAN_ORDER[i % 10] + DI_ZHI_ORDER[i % 12]);
  }
  return arr;
})();

/** 六旬空亡：每旬 10 组干支配完，余下两个地支即为空亡 */
const XUN_KONG_BY_INDEX: string[][] = [
  ['戌', '亥'], // 甲子旬 (0-9)
  ['申', '酉'], // 甲戌旬 (10-19)
  ['午', '未'], // 甲申旬 (20-29)
  ['辰', '巳'], // 甲午旬 (30-39)
  ['寅', '卯'], // 甲辰旬 (40-49)
  ['子', '丑'], // 甲寅旬 (50-59)
];

/**
 * 按日干支取旬空地支。
 * 算法：先查日干支在 60 甲子中的序号，再按 floor(idx/10) 定其所属旬，返回该旬空亡。
 * 例：甲午 → idx=30 → 第 3 旬(甲午旬) → 空辰巳。
 */
function kongWangOfDay(dayGanZhi: string): string[] {
  const idx = JIA_ZI.indexOf(dayGanZhi);
  if (idx < 0) return [];
  return XUN_KONG_BY_INDEX[Math.floor(idx / 10)] || [];
}

/** 月破：与月支相冲的爻地支 */
const DIZHI_CHONG: Record<string, string> = {
  子: '午', 午: '子', 丑: '未', 未: '丑',
  寅: '申', 申: '寅', 卯: '酉', 酉: '卯',
  辰: '戌', 戌: '辰', 巳: '亥', 亥: '巳',
};

function yuePoOfMonth(monthZhi: string): string {
  return DIZHI_CHONG[monthZhi] || '';
}

// ─── 主入口 ───────────────────────────────────────

export interface LiuyaoValidation {
  ok: boolean;
  error?: string;
}

export function validateLiuyaoInput(input: {
  solarDate?: unknown;
  timeIndex?: unknown;
  method?: unknown;
  manualYao?: unknown;
  numberA?: unknown;
  numberB?: unknown;
}): LiuyaoValidation {
  const { solarDate, timeIndex, method, manualYao, numberA, numberB } = input;
  if (typeof solarDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(solarDate)) {
    return { ok: false, error: '请提供 YYYY-MM-DD 格式的起卦日期' };
  }
  const d = new Date(solarDate + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return { ok: false, error: '起卦日期无效' };
  if (typeof timeIndex !== 'number' || timeIndex < 0 || timeIndex > 11 || !Number.isInteger(timeIndex)) {
    return { ok: false, error: '请提供 0-11 的时辰索引' };
  }
  if (method !== 'time' && method !== 'number' && method !== 'manual') {
    return { ok: false, error: '起卦方式必须为 time / number / manual' };
  }
  if (method === 'manual') {
    if (!Array.isArray(manualYao) || manualYao.length !== 6) {
      return { ok: false, error: '手动起卦需提供 6 个爻的阴阳值' };
    }
    for (const v of manualYao) {
      if (typeof v !== 'boolean') return { ok: false, error: '手动起卦的爻值必须为 boolean' };
    }
  }
  if (method === 'number') {
    if (typeof numberA !== 'number' || typeof numberB !== 'number') {
      return { ok: false, error: '数字起卦需提供两个数字' };
    }
    if (numberA < 1 || numberA > 999 || numberB < 1 || numberB > 999) {
      return { ok: false, error: '数字起卦的两个数字需在 1-999 范围' };
    }
  }
  return { ok: true };
}

export function castLiuyaoChart(input: LiuyaoInput): LiuyaoFullResult {
  // 时辰必须参与起卦：时柱干支与"下卦数"都依赖它。
  // 时辰序号 → 小时：子=0、丑=2、寅=4 …… 亥=22（各取该时辰起点，子时跨 23-01 故取 0 点）。
  const solar = Solar.fromYmdHms(
    Number(input.solarDate.slice(0, 4)),
    Number(input.solarDate.slice(5, 7)),
    Number(input.solarDate.slice(8, 10)),
    input.timeIndex * 2,
    0,
    0,
  );
  const lunar = solar.getLunar();
  const ganzhi = {
    year: lunar.getYearInGanZhiExact(),
    month: lunar.getMonthInGanZhiExact(),
    day: lunar.getDayInGanZhiExact(),
    time: lunar.getTimeInGanZhi(),
  };

  // ── 步骤 1：定本卦六爻阴阳与动爻
  let benYaos: boolean[];
  let dongIndices: number[];
  if (input.method === 'time') {
    const r = yaosFromTime(solar);
    benYaos = r.yaos;
    dongIndices = r.dongIndices;
  } else if (input.method === 'number') {
    const r = yaosFromNumber(input.numberA ?? 1, input.numberB ?? 1);
    benYaos = r.yaos;
    dongIndices = r.dongIndices;
  } else {
    // manual
    benYaos = input.manualYao!;
    // manual 默认第 3 爻动；如外部提供 dongIndices 可叠加（本期简化为固定第 3 爻）
    dongIndices = [3];
  }

  // 变卦：动爻阴阳翻转，其它不变
  const bianYaos = benYaos.map((v, i) => (dongIndices.includes(i + 1) ? !v : v));

  const benTri = trigramsFromYaos(benYaos);
  const bianTri = trigramsFromYaos(bianYaos);
  const benUpper = trigramName(benTri.upper);
  const benLower = trigramName(benTri.lower);
  const bianUpper = trigramName(bianTri.upper);
  const bianLower = trigramName(bianTri.lower);
  const benGua = hexagramName(benUpper, benLower);
  const bianGua = hexagramName(bianUpper, bianLower);

  // ── 步骤 2：本卦所属宫 + 世爻
  const guaGong = guaGongByName(benGua);
  // 卦宫五行决定六亲：必须用八宫五行表（乾兑金/离火/震巽木/坎水/艮坤土），
  // 不可按卦象五行取——宫五行与卦象五行在八宫体系下是两个不同概念。
  const guaGongWuxing = GONG_WUXING[guaGong] || '土';
  const shiYaoIdx = shiYaoPosition(benGua);
  const yingYaoIdx = yingYaoPosition(shiYaoIdx);

  // ── 步骤 3：装六爻（纳甲 + 六亲 + 六兽）
  const liushouList = liushouByDay(ganzhi.day.slice(1, 2));
  const benNaiJia = NAI_JIA_TABLE[benLower];
  const bianNaiJia = NAI_JIA_TABLE[bianLower];

  // 京房纳甲取位规则：每经卦自带六位纳甲，前三位属内卦（初/二/三爻）、后三位属外卦（四/五/六爻）。
  // 故下卦三爻取下卦经卦的 index 0-2，上卦三爻取上卦经卦的 index 3-5——统一为 pos-1。
  const benNaiJiaForYao = (pos: number): { gan: string; zhi: string } => {
    const t = pos <= 3 ? benNaiJia : NAI_JIA_TABLE[benUpper];
    return { gan: t.gan[pos - 1], zhi: t.zhi[pos - 1] };
  };
  const bianNaiJiaForYao = (pos: number): { gan: string; zhi: string } => {
    const t = pos <= 3 ? bianNaiJia : NAI_JIA_TABLE[bianUpper];
    return { gan: t.gan[pos - 1], zhi: t.zhi[pos - 1] };
  };

  const yaoList: LiuyaoYao[] = [];
  for (let pos = 1; pos <= 6; pos++) {
    const yinyang = benYaos[pos - 1] ? '阳' : '阴';
    const isDong = dongIndices.includes(pos);
    const ben = benNaiJiaForYao(pos);
    const zhiWuxing = DIZHI_WUXING[ben.zhi] || '土';
    const liuqin = computeLiuqin(guaGongWuxing, zhiWuxing);
    const liushou = liushouList[pos - 1];
    const yao: LiuyaoYao = {
      position: pos,
      yinYang: yinyang,
      gan: ben.gan,
      zhi: ben.zhi,
      zhiWuxing,
      liuqin,
      liushou,
      isShi: pos === shiYaoIdx,
      isYing: pos === yingYaoIdx,
      isDong,
    };
    if (isDong) {
      const b = bianNaiJiaForYao(pos);
      yao.bianYinYang = bianYaos[pos - 1] ? '阳' : '阴';
      yao.bianGan = b.gan;
      yao.bianZhi = b.zhi;
    }
    yaoList.push(yao);
  }

  const liuqinOfShi = yaoList[shiYaoIdx - 1].liuqin;
  const chart: LiuyaoChart = {
    benGua,
    benUpperTrigram: benUpper,
    benLowerTrigram: benLower,
    bianGua,
    bianUpperTrigram: bianUpper,
    bianLowerTrigram: bianLower,
    dongYaoIndices: dongIndices,
    shiYaoIndex: shiYaoIdx,
    yingYaoIndex: yingYaoIdx,
    guaGong,
    guaGongWuxing,
    liuqinOfSelf: liuqinOfShi,
    yaoList,
  };

  // ── 步骤 4：用神推算（用神六亲 + 用神爻位；优先取动爻中匹配者，其次取静爻中匹配者）
  const ys = yongShenForQuestion(input.questionType, liuqinOfShi, input.gender || '不指定');
  let yongShenPos: number | null = null;
  const dongMatch = yaoList.find((y) => y.isDong && y.liuqin === ys.name);
  if (dongMatch) {
    yongShenPos = dongMatch.position;
  } else {
    const staticMatch = yaoList.find((y) => y.liuqin === ys.name);
    yongShenPos = staticMatch ? staticMatch.position : null;
  }
  // 命名规则：有爻位时展示"用神名：爻位纳甲（五行）"；无爻位（八纯卦缺用神/伏神）时返回"用神名（伏神/变卦参看）"，
  // 让 LLM 解读端统一处理「用神伏藏」叙述。
  const yongShenDetail = yongShenPos
    ? `${ys.name}爻：${yaoList[yongShenPos - 1].gan}${yaoList[yongShenPos - 1].zhi}（${yaoList[yongShenPos - 1].zhiWuxing}）`
    : `${ys.name}（本卦未直接出现，看伏神/变卦之爻）`;

  // ── 步骤 5：深度分析（旺衰 / 日辰作用 / 五神 / 伏神 / 应期 / 地支格局）
  const kongs = kongWangOfDay(ganzhi.day);
  const yuePo = yuePoOfMonth(ganzhi.month.slice(1, 2));
  const detected: LiuyaoFullResult['detectedPatterns'] = [];

  const analysis = analyzeLiuyao({
    yaos: yaoList.map((y) => ({
      position: y.position,
      zhi: y.zhi,
      liuqin: y.liuqin,
      isDong: y.isDong,
      bianZhi: y.bianZhi,
      isShi: y.isShi,
      isYing: y.isYing,
    })),
    monthZhi: ganzhi.month.slice(1, 2),
    dayZhi: ganzhi.day.slice(1, 2),
    kongWang: kongs,
    yongShenLiuqin: ys.name,
    guaGong,
  });

  // 全局背景：日柱旬空（逐爻的真空/暂空区分由 analysis 给出，此处只记旬空整体）
  if (kongs.length > 0) {
    detected.push({
      name: `日空亡（${kongs.join('/')}）`,
      nature: '中性',
      note: '空亡不直接等于坏，主力量虚、易落空拖延、待时填实；逐爻真假见【逐爻分析】',
    });
  }

  // 用神层面的结论（断卦关键，单独凸显，不靠逐爻清单淹没）
  const yongShenYao = yongShenPos ? yaoList[yongShenPos - 1] : null;
  const yongShenAna = yongShenPos ? analysis.yaoAnalysis.find((a) => a.position === yongShenPos) : undefined;
  if (yongShenYao && yongShenAna) {
    if (yongShenYao.zhi === yuePo) {
      detected.push({ name: '用神月破', nature: '凶', note: '用神受月冲，主破散，所问之事难以成就' });
    }
    if (yongShenAna.voidState === '真亡') {
      detected.push({ name: '用神真空', nature: '凶', note: '用神静空休囚未得日助为真亡，不受动变冲实，所求不成' });
    } else if (yongShenAna.voidState === '暂空') {
      detected.push({ name: '用神暂空', nature: '中性', note: '用神暂空，出空填实日再应已受之生吉或克凶' });
    }
    if (yongShenAna.isDayBreak) {
      detected.push({ name: '用神日破', nature: '凶', note: '用神被日辰冲散，动变均失用' });
    }
    if (yongShenAna.isAnDong) {
      detected.push({ name: '用神暗动', nature: '中性', note: '用神暗动，外力使令而动，有生克资格但程度看旺衰' });
    }
    detected.push({
      name: `用神${yongShenAna.strength === '强' ? '旺相有力' : yongShenAna.strength === '弱' ? '休囚无力' : '旺衰中和'}`,
      nature: yongShenAna.strength === '强' ? '吉' : yongShenAna.strength === '弱' ? '凶' : '中性',
      note: `月令${yongShenAna.monthPower}（${yongShenAna.isDeshi ? '得令' : '失令'}）· 日辰${yongShenAna.dayRelation || '无作用'}`,
    });
  }
  // 用神伏藏（八纯卦等本卦不现用神时）
  if (analysis.fuShen) {
    detected.push({
      name: `用神伏藏（伏${analysis.fuShen.position}爻${analysis.fuShen.zhi}·${analysis.fuShen.state}）`,
      nature: analysis.fuShen.state === '开伏' ? '中性' : '凶',
      note: analysis.fuShen.reason,
    });
  }

  // 合并深度分析命中的逐爻状态与地支格局（六冲/六合/三合/三刑/进退/回头生克 等）
  detected.push(...analysis.patterns);

  // ── 步骤 6：边界提醒
  const warnings: string[] = [];
  if (input.method === 'manual' && !input.manualYao) {
    warnings.push('手动起卦必须提供 6 个爻的阴阳值');
  }
  // 用神 null 在八纯卦（乾/坤/震/巽/坎/离/艮/兑）属正常现象：本身只含两种六亲，
  // 此时由 LLM 解读端按"伏神/变卦/外应"思路补足，不再标记为异常。
  if (detected.length === 0) {
    detected.push({ name: '本局无特殊格局', nature: '中性', note: '用神与世应均不受空亡月破直接冲击，可正常解卦' });
  }

  return {
    input,
    ganzhi,
    chart,
    yongShen: { name: yongShenDetail, reason: ys.reason, position: yongShenPos },
    detectedPatterns: detected,
    analysis,
    warnings,
  };
}

/**
 * 抽取历史查阅用的"排卦骨架"（落入 D1 chart_summary 字段，上限 12k 字节）。
 * 设计决策：不直接存全 result（避免大对象），仅保留与解卦相关的关键字段。
 * 注：本结构与上面 return 的 chart 子结构保持一致；若未来 chart 加字段，本函数须同步扩展。
 */
export function extractChartSummary(result: LiuyaoFullResult) {
  const { ganzhi, chart, yongShen, detectedPatterns, analysis } = result;
  return {
    四柱: ganzhi,
    本卦: {
      卦名: chart.benGua,
      上卦: chart.benUpperTrigram,
      下卦: chart.benLowerTrigram,
      宫: chart.guaGong,
      宫五行: chart.guaGongWuxing,
      世爻: chart.shiYaoIndex,
      应爻: chart.yingYaoIndex,
      动爻: chart.dongYaoIndices,
      卦主六亲: chart.liuqinOfSelf,
    },
    变卦: {
      卦名: chart.bianGua,
      上卦: chart.bianUpperTrigram,
      下卦: chart.bianLowerTrigram,
    },
    用神: yongShen,
    命中格局: detectedPatterns.map((p) => ({ 名称: p.name, 性质: p.nature, 释义: p.note })),
    爻明细: chart.yaoList.map((y) => {
      const a = analysis.yaoAnalysis.find((x) => x.position === y.position);
      const marks: string[] = [];
      if (a) {
        if (a.isMonthBreak) marks.push('月破');
        if (a.isAnDong) marks.push('暗动');
        if (a.isDayBreak) marks.push('日破');
        if (a.graveZhi) marks.push(`入墓${a.graveZhi}`);
        if (a.jinTui) marks.push(a.jinTui);
        if (a.huiTou) marks.push(a.huiTou);
      }
      return {
        爻位: y.position,
        阴阳: y.yinYang,
        纳甲: `${y.gan}${y.zhi}`,
        五行: y.zhiWuxing,
        六亲: y.liuqin,
        六兽: y.liushou,
        世应: y.isShi ? '世' : y.isYing ? '应' : '',
        动爻: y.isDong ? `动→${y.bianYinYang} ${y.bianGan}${y.bianZhi}` : '',
        月令: a ? `${a.monthPower}${a.isDeshi ? '(得令)' : '(失令)'}` : '',
        日辰: a ? a.dayRelation || '无' : '',
        强弱: a ? a.strength : '',
        空亡: a ? a.voidState : '',
        特殊: marks.join('/') || '无',
      };
    }),
    五神: {
      用神: analysis.fiveShen.yongShen,
      原神: analysis.fiveShen.yuanShen,
      忌神: analysis.fiveShen.jiShen,
      仇神: analysis.fiveShen.chouShen,
      喜神: analysis.fiveShen.xiShen,
      口径: analysis.fiveShen.intent,
    },
    伏神: analysis.fuShen
      ? {
          六亲: analysis.fuShen.liuqin,
          爻位: analysis.fuShen.position,
          地支: analysis.fuShen.zhi,
          飞爻: `第${analysis.fuShen.feiPosition}爻${analysis.fuShen.feiZhi}`,
          状态: analysis.fuShen.state,
          理由: analysis.fuShen.reason,
        }
      : '用神在卦，无需伏神',
    应期候选: analysis.timings.map((t) => ({
      机制: t.mechanism,
      触发地支: t.triggerBranch || '—',
      含义: t.meaning,
      快慢: t.speed,
    })),
    间爻: analysis.jianYao.length > 0 ? analysis.jianYao : '世应相邻，无间爻',
  };
}

// ─── Prompt 构建（系统侧解卦规则 + 用户上下文） ─────────────────

import { CONSTITUTION } from '@/lib/ai/prompt-constitution';

const LIUYAO_MODULE_SPECIFIC = `【六爻模块专项·京房纳甲体系】
1. 体系定位：京房八宫六十四卦 + 纳甲装卦。装六亲（父母/兄弟/子孙/妻财/官鬼）、装六兽（青龙/朱雀/勾陈/螨蛇/白虎/玄武）、定世应、取用神、推五神（原神/忌神/仇神/喜神）、查伏神、定应期。

2. 【卦宫铁律】六亲由「卦宫五行」决定，不是卦象五行。八宫五行：乾兑金、离火、震巰木、坎水、艮坤土。【确定性盘面骨架】中「本卦.宫」与「宫五行」为唯一权威，不得自行改判宫位，也不得改按上下卦象取五行。

3. 【旺衰与强弱·两段论】
   · 旺衰由月令定（原局背景）：当令者旺、我生者相、生我者休、克我者囚、我克者死。得令 = 旺或相。
   · 强弱由日辰与动变定（当下能否发力）：日辰生合为有助、日辰克冲为受制。
   · 结论口径：旺衰是底子，强弱是当下。「月令旺但日克」不等于无用，「月令衰但日生」也不等于可用——必须两段合并陈述，不得只拿一段下定论。

4. 【空亡真假】
   · 暂空：动空（不论旺衰）、静空但旺相、静空休囚而得日辰生助 → 出空填实日再应；有权动变冲之为冲实有用。
   · 真亡（真空）：静空且休囚且未得日辰生助、或用神空化空 → 不受动变冲实、不主动作用，所求不成。
   · 不得一律把空亡说成「凶」，也不得一律说成「拖延」。

5. 【日辰四种作用】
   · 生/合：为有助，增力。
   · 克：为受制，减力。
   · 冲静爻（非空）：为暗动——由外力使令而动，有生克资格但不能独立冲合；衰暗动仍有生克资格，旺衰只表程度。
   · 冲动爻：为日破（冲散）——动变均失用；日冲变爻亦称日破。
   · 月破（月支冲爻）：为原局背景中的残缺破损，须以所问欲成欲散定吉凶，不凭破断事实。

6. 【进退神与回头生克】
   · 化进：吉用与原神宜进；休囚化进者近事暂不进。
   · 化退：忌神仇神宜退；旺相化退者近事暂不退。所求是解除凶患时，凶用退才有利。
   · 回头克：动化之爻克原动爻，无有效解救时原动爻力量被克尽；有解救须查贪生忘克。
   · 回头生：动化之爻生原动爻，主自身变化带来成就。

7. 【五神与欲成欲散】
   · 原神生用神、忌神克用神、仇神生忌神且克原神、喜神克忌神。
   · 不得用「耗」「泄」解释五神。
   · 口径：吉用（想成/想得）时原神喜神为吉、忌神仇神为凶；凶用（想散/想败）时反是。
   · 冲对欲聚欲成之事为忌，对欲散欲脱之事为喜——同一格局在不同口径下吉凶相反，必须先定口径再断吉凶。

8. 【地支格局取象，不擅断事实】
   · 冲主快、散、改变；合主聚集、协作、迟缓。
   · 六害、六破只取失约、阻隔、被干涉、破坏之象，不另增吉凶权重（六害须先有合再被冲破方论）。
   · 三合局须三支齐全并满足动变条件，化局作一条主作用，取多人结伙、聚会之象。
   · 三刑须三支俱全且卦爻俱动，或两发动刑支与日辰浑齐；吉凶随旺衰与有无制救。辰午酉亥自刑不主吉凶，只取自作自受、烦恼之象。
   · 入墓：实际入墓者暂停主动与受作用权；动冲墓或流时冲墓为出墓应事条件。
   · 间爻（世应之间的爻）主中间人、中介、阻隔环节。

9. 【伏神飞伏】用神不上卦时查本宫伏神。开伏（日生伏/日值伏/日冲伏不带克/飞爻空/飞生伏）则伏神可出、待时引出；闭伏（日克伏/飞克伏）则须先解除飞爻覆盖。不得因用神不上卦就断定「此事不可成」。

10. 【取用神，轻六神】用神为吉凶主判依据；六兽（青龙朱雀勾陈螨蛇白虎玄武）只作人物情状、事态气氛的辅助描述，不得单凭六兽定吉凶。

11. 【应期】严格按【应期候选】给出的机制与触发地支陈述（逢值/逢冲/逢合/出空填实/冲墓/出月令/化进化退）。只给地支与条件，绝不换算成具体公历日期，不承诺「某月某日」。

12. 【断卦顺序·三段递进】先本卦（定用神、看月令旺衰、看世应）→ 再看变爻（动爻化什么、回头生克、进退神）→ 最后看日辰（生克冲合、暗动日破、出空出墓）。三段结论合并后再下吉凶判断，不得跳过任一段直接给结论。

13. 【术语规范】世爻/应爻/用神/原神/忌神/仇神/喜神/伏神/飞爻；动爻/变爻/化进/化退/回头生克；六亲仅限父母/兄弟/子孙/妻财/官鬼；六兽仅限上述六名。不得使用「灵魂伴侣」「能量场」等口语化/泛灵性词汇。

14. 调理建议按调理建议操作性铁律展开：用神旺相则顺势而进，用神休囚或暂空则填实/扶持，用神被克则泄化/通关（按相生链通关）。`;

export interface LiuyaoPromptBundle {
  systemPrompt: string;
  userPrompt: string;
  chartContext: string;
}

/** 构造六爻解卦 prompt：公因子 + 模块专项 + 确定性盘面骨架 */
export function buildLiuyaoPrompt(
  input: LiuyaoInput,
  result: LiuyaoFullResult,
  summary: ReturnType<typeof extractChartSummary>,
): LiuyaoPromptBundle {
  const systemPrompt = CONSTITUTION + '\n\n' + LIUYAO_MODULE_SPECIFIC;

  // 用户提示词：起卦时四柱 + 问事 + 用神推算 + 期望结构（八段）
  const userPrompt = [
    '【用户问事】',
    `问事类型：${input.questionType || '未指定'}`,
    `问事具体：${input.questionGoal || '未详述'}`,
    `起卦方式：${input.method === 'time' ? '时间起卦' : input.method === 'number' ? '数字起卦' : '手动爻'}`,
    input.gender ? `性别：${input.gender}` : '',
    '',
    '【确定性盘面骨架】（请逐项引用，禁止重新计算）',
    JSON.stringify(summary, null, 2),
    '',
    '【期望输出结构】（九段依次给出，每段以【】单独成行）',
    '【断事总纲】本卦卦象、所属宫位与宫五行、整体吉凶倾向（150 字内）。',
    '【世应关系】世爻与应爻的五行生克、世应动静、间爻有无；代表求测者与外部环境的态势。',
    '【用神旺衰】用神六亲与爻位；月令旺相休囚死（得令与否）、日辰生克冲合、强弱结论、空亡真假（须引用【爻明细】的月令/日辰/强弱/空亡字段）；用神不上卦时须说明伏神爻位与开闭伏。',
    '【五神生克】按【五神】逐项说明原神/忌神/仇神/喜神在卦中的旺衰与动静，及其对用神的利害；必须先说明本局属吉用还是凶用口径。',
    '【动爻与变卦】动爻位置、变卦名、变爻纳甲与五行变化、化进化退、回头生克，以及对本卦的转化方向。',
    '【命中格局】依【命中格局】清单逐项解读（六冲/六合/三合局/三刑/六害/六破/月破/暗动/日破/真空暂空/入墓），并说明对用神与世应的影响。',
    '【事态推断与应期】结合问事类型给出具体走向；应期严格按【应期候选】的机制与触发地支陈述，只给地支条件、不换算公历日期。',
    '【调理建议】按调理建议操作性铁律展开，至少 3 条可立即执行的物品/方位/动作建议。',
    '【风险与边界】明确说明本判断的局限与不确定点，建议咨询专业人士的场景（如重大财务决定、健康疑虑、法律纠纷）。',
  ]
    .filter((s) => s !== '')
    .join('\n');

  // 盘面骨架作为独立字段写日志（不入 userPrompt，避免 prompt 越来越长）
  const chartContext = JSON.stringify(summary);

  return { systemPrompt, userPrompt, chartContext };
}
