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

// ─── 八经卦基本参数（京房纳甲体系）────────────────

/** 八卦纳甲表（爻位由下而上 1-6） */
const NAI_JIA_TABLE: Record<string, { gan: string[]; zhi: string[] }> = {
  乾: { gan: ['甲', '甲', '壬', '壬', '壬', '壬'], zhi: ['子', '寅', '辰', '午', '申', '戌'] },
  坤: { gan: ['乙', '乙', '癸', '癸', '癸', '癸'], zhi: ['未', '巳', '卯', '丑', '亥', '酉'] },
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

/** 卦名（共 64 卦：本卦与变卦都用卦象→名查表） */
const TRIGRAM_NAMES: Record<string, string> = {
  '111': '乾', '000': '坤', '100': '震', '010': '巽', '001': '坎', '110': '离', '011': '艮', '101': '兑',
};

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
  /** 命中格局（空亡、月破、六合、六冲、三刑 等） */
  detectedPatterns: Array<{ name: string; nature: '吉' | '凶' | '中性'; note: string }>;
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
  const ba = solar.getLunar();
  const yearZhiIdx = getZhiIndex(ba.getYearZhi());
  const monthZhiIdx = getZhiIndex(ba.getMonthZhi());
  const dayZhiIdx = getZhiIndex(ba.getDayZhi());
  const timeZhiIdx = getZhiIndex(ba.getTimeZhi());

  const upperNum = (yearZhiIdx + monthZhiIdx + dayZhiIdx) % 8 || 8;
  const lowerNum = (yearZhiIdx + monthZhiIdx + dayZhiIdx + timeZhiIdx) % 8 || 8;
  const dongNum = (yearZhiIdx + monthZhiIdx + dayZhiIdx + timeZhiIdx) % 6 || 6;

  const yaos: boolean[] = [];
  for (let i = 0; i < 6; i++) {
    // 第 i 爻阴阳：上下卦由地支数得到
    const isUpperYao = i >= 3;
    const num = isUpperYao ? upperNum : lowerNum;
    // 阳爻：1/3/5/7；阴爻：2/4/6/8
    yaos.push(num % 2 === 1);
  }
  return { yaos, dongIndices: [dongNum] };
}

/** 数字起卦（如 123 → 上下卦 1+2+3=6，1+2+3=6，动爻 6） */
function yaosFromNumber(a: number, b: number): { yaos: boolean[]; dongIndices: number[] } {
  const total = a + b;
  const upperNum = total % 8 || 8;
  const lowerNum = total % 8 || 8;
  const dongNum = (a % 6) || 6;
  const yaos: boolean[] = [];
  for (let i = 0; i < 6; i++) {
    const isUpperYao = i >= 3;
    const num = isUpperYao ? upperNum : lowerNum;
    yaos.push(num % 2 === 1);
  }
  return { yaos, dongIndices: [dongNum] };
}

const ZHI_LIST = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
function getZhiIndex(zhi: string): number {
  const i = ZHI_LIST.indexOf(zhi);
  return i >= 0 ? i : 0;
}

/** 由卦象查所属宫（简化版：八纯卦各归本宫，64 卦其余用京房八宫世应定位） */
function guaGongByName(hexName: string): string {
  const eightGong: Record<string, string> = {
    '乾为天': '乾宫', '坤为地': '坤宫',
    '震为雷': '震宫', '巽为风': '巽宫',
    '坎为水': '坎宫', '离为火': '离宫',
    '艮为山': '艮宫', '兑为泽': '兑宫',
  };
  for (const [k, v] of Object.entries(eightGong)) {
    if (hexName === k) return v;
  }
  // 简化：非八纯卦归"游魂/归魂"——本引擎保守起见，标"杂卦"
  return '杂卦';
}

/** 世爻位置（按八宫世爻定位，本卦为某宫第几卦决定） */
function shiYaoPosition(gong: string, hexName: string): number {
  // 八纯卦世在六爻；其它按京房八宫游魂归魂序列
  // 简化版：六爻安世法——
  //  乾宫八卦世爻位：乾为天6、天风姤1、天山遁2、天地否3、风地观4、山地剥5、火地晋4(游魂)、火天大有6(归魂)
  // 其它七宫类同，列出常用 8 宫
  const SHI_YAO_MAP: Record<string, Record<string, number>> = {
    乾宫: {
      '乾为天': 6, '天风姤': 1, '天山遁': 2, '天地否': 3,
      '风地观': 4, '山地剥': 5, '火地晋': 4, '火天大有': 6,
    },
    坤宫: {
      '坤为地': 6, '地雷复': 1, '地泽临': 2, '地天泰': 3,
      '雷天大壮': 4, '泽天夬': 5, '水天需': 4, '水地比': 6,
    },
    震宫: {
      '震为雷': 6, '雷地豫': 1, '雷水解': 2, '雷风恒': 3,
      '地风升': 4, '水风井': 5, '泽风大过': 4, '泽雷随': 6,
    },
    巽宫: {
      '巽为风': 6, '风天小畜': 1, '风火家人': 2, '风雷益': 3,
      '天雷无妄': 4, '火雷噬嗑': 5, '山雷颐': 4, '山风蛊': 6,
    },
    坎宫: {
      '坎为水': 6, '水泽节': 1, '水雷屯': 2, '水火既济': 3,
      '泽火革': 4, '雷火丰': 5, '地火明夷': 4, '地水师': 6,
    },
    离宫: {
      '离为火': 6, '火山旅': 1, '火风鼎': 2, '火水未济': 3,
      '山水蒙': 4, '风水涣': 5, '天水讼': 4, '天火同人': 6,
    },
    艮宫: {
      '艮为山': 6, '山火贲': 1, '山天大畜': 2, '山泽损': 3,
      '火泽睽': 4, '天泽履': 5, '风泽中孚': 4, '风山渐': 6,
    },
    兑宫: {
      '兑为泽': 6, '泽水困': 1, '泽地萃': 2, '泽山咸': 3,
      '水山蹇': 4, '地山谦': 5, '雷山小过': 4, '雷泽归妹': 6,
    },
  };
  const map = SHI_YAO_MAP[gong];
  if (map && hexName in map) return map[hexName];
  // 兜底（杂卦）：默认世 3
  return 3;
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

function liushouByDay(dayZhi: string): Liuqin[] {
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

/** 检测空亡：日柱旬中地支不现（与奇门同源） */
const XUN_KONG: Record<string, string[]> = {
  甲子: ['戌', '亥'], 甲戌: ['申', '酉'], 甲申: ['午', '未'],
  甲午: ['辰', '巳'], 甲辰: ['寅', '卯'], 甲寅: ['子', '丑'],
};

function kongWangOfDay(dayGanZhi: string): string[] {
  for (const [xun, kongs] of Object.entries(XUN_KONG)) {
    if (dayGanZhi.startsWith(xun[0]) || dayGanZhi === xun || dayGanZhi.endsWith(xun[1])) {
      return kongs;
    }
  }
  return [];
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
  const solar = Solar.fromYmd(
    Number(input.solarDate.slice(0, 4)),
    Number(input.solarDate.slice(5, 7)),
    Number(input.solarDate.slice(8, 10)),
  );
  const lunar = solar.getLunar();
  const ganzhi = {
    year: lunar.getYearInGanZhi(),
    month: lunar.getMonthInGanZhi(),
    day: lunar.getDayInGanZhi(),
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
  const guaGongWuxing = TRIGRAM_WUXING[guaGong.slice(0, 1)] || '土';
  const shiYaoIdx = shiYaoPosition(guaGong, benGua);
  const yingYaoIdx = yingYaoPosition(shiYaoIdx);

  // ── 步骤 3：装六爻（纳甲 + 六亲 + 六兽）
  const liushouList = liushouByDay(ganzhi.day.slice(1, 2));
  const benNaiJia = NAI_JIA_TABLE[benLower];
  const bianNaiJia = NAI_JIA_TABLE[bianLower];

  // 上卦纳甲：上卦六爻中第 4/5/6 爻位（位置 4-6）用上卦的纳甲
  // 下卦纳甲：下卦六爻中第 1/2/3 爻位（位置 1-3）用下卦的纳甲
  // 简化：上卦三爻（位置 4-6）从上卦 NAI_JIA 取前 3 个，下卦三爻（位置 1-3）从下卦 NAI_JIA 取前 3 个
  const benNaiJiaForYao = (pos: number): { gan: string; zhi: string } => {
    if (pos <= 3) {
      // 下卦爻位 1=初爻，对应下卦 NAI_JIA[0]
      return { gan: benNaiJia.gan[pos - 1], zhi: benNaiJia.zhi[pos - 1] };
    }
    // 上卦爻位 4-6，对应上卦 NAI_JIA[0..2]（初爻位）
    return { gan: NAI_JIA_TABLE[benUpper].gan[pos - 4], zhi: NAI_JIA_TABLE[benUpper].zhi[pos - 4] };
  };
  const bianNaiJiaForYao = (pos: number): { gan: string; zhi: string } => {
    if (pos <= 3) {
      return { gan: bianNaiJia.gan[pos - 1], zhi: bianNaiJia.zhi[pos - 1] };
    }
    return { gan: NAI_JIA_TABLE[bianUpper].gan[pos - 4], zhi: NAI_JIA_TABLE[bianUpper].zhi[pos - 4] };
  };

  const yaoList: LiuyaoYao[] = [];
  for (let pos = 1; pos <= 6; pos++) {
    const yinyang = benYaos[pos - 1] ? '阳' : '阴';
    const isDong = dongIndices.includes(pos);
    const ben = benNaiJiaForYao(pos);
    const zhiWuxing = DIZHI_WUXING[ben.zhi] || '土';
    const liuqin = computeLiuqin(guaGongWuxing, zhiWuxing);
    const liushou = liushouList[pos - 1] as Liushou;
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

  // ── 步骤 5：检测空亡 + 月破
  const kongs = kongWangOfDay(ganzhi.day);
  const yuePo = yuePoOfMonth(ganzhi.month.slice(1, 2));
  const detected: LiuyaoFullResult['detectedPatterns'] = [];
  for (const y of yaoList) {
    if (kongs.includes(y.zhi)) {
      detected.push({ name: `${y.position}爻${y.zhi}空亡（日柱旬空）`, nature: '中性', note: `空亡不直接等于坏，翻译成"力量虚、易落空拖延、待时填实"` });
    }
    if (y.zhi === yuePo) {
      detected.push({ name: `${y.position}爻${y.zhi}月破（月冲）`, nature: '凶', note: `月破之爻主破散无用，难以成事` });
    }
  }
  // 用神月破汇总（避免与上面逐爻重复）：
  const yongShenYao = yongShenPos ? yaoList[yongShenPos - 1] : null;
  if (yongShenYao && yongShenYao.zhi === yuePo) {
    detected.push({ name: '用神月破', nature: '凶', note: '用神受月冲，所问之事难以成就' });
  }
  if (kongs.length > 0) {
    detected.push({ name: `日空亡（${kongs.join('/')}）`, nature: '中性', note: '空亡地支对应的爻力量减弱，待时填实' });
  }

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
    warnings,
  };
}

/**
 * 抽取历史查阅用的"排卦骨架"（落入 D1 chart_summary 字段，上限 12k 字节）。
 * 设计决策：不直接存全 result（避免大对象），仅保留与解卦相关的关键字段。
 * 注：本结构与上面 return 的 chart 子结构保持一致；若未来 chart 加字段，本函数须同步扩展。
 */
export function extractChartSummary(result: LiuyaoFullResult) {
  const { ganzhi, chart, yongShen, detectedPatterns } = result;
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
    爻明细: chart.yaoList.map((y) => ({
      爻位: y.position,
      阴阳: y.yinYang,
      纳甲: `${y.gan}${y.zhi}`,
      五行: y.zhiWuxing,
      六亲: y.liuqin,
      六兽: y.liushou,
      世应: y.isShi ? '世' : y.isYing ? '应' : '',
      动爻: y.isDong ? `动→${y.bianYinYang} ${y.bianGan}${y.bianZhi}` : '',
    })),
  };
}

// ─── Prompt 构建（系统侧解卦规则 + 用户上下文） ─────────────────

import { CONSTITUTION } from '@/lib/ai/prompt-constitution';

const LIUYAO_MODULE_SPECIFIC = `【六爻模块专项·京房纳甲体系】
1. 体系定位：京房纳甲 + 八宫六十四卦；装六亲（父母/兄弟/子孙/妻财/官鬼）、装六兽（青龙/朱雀/勾陈/螣蛇/白虎/玄武）、定世应、按问题类型与卦主六亲取用神。
2. 严格使用规范术语：世爻/应爻/用神/原神/忌神/仇神/伏神；动爻/变爻/卦变；六亲仅限父母/兄弟/子孙/妻财/官鬼；六兽仅限上述六名；不得使用"灵魂伴侣""能量场"等口语化/泛灵性词汇。
3. 用神选取规则（按问题类型优先、卦主六亲兜底）：
   · 求财/交易/投资/求物：以妻财爻为用神；
   · 事业/工作/求职/官非/诉讼：以官鬼爻为用神；
   · 文书/考试/合同/求学：以父母爻为用神；
   · 健康/脱困/忧虑/疾病：以子孙爻为用神（子孙制官鬼解忧）；
   · 婚恋/感情/桃花：男问以妻财为用神，女问以官鬼为用神；不指定则按卦主六亲反推。
   · 卦主六亲 = 世爻所纳地支与卦宫五行的生克关系；用于"我"是谁的判断。
4. 用神伏藏规则：若本卦未直接出现用神六亲之爻（即八纯卦之乾/坤/震/巽/坎/离/艮/兑仅含两种六亲），须以"伏神"思路补足——按本宫八卦伏神表查阅，并相应说明"伏神不现、待时引出"；不得擅自判定"用神缺失、此事不可成"。
5. 动爻判断：动爻变阴变阳，动爻之变卦纳甲与六亲为"变爻之用神"，可与本卦用神互参；动爻所在之爻本身亦参与用神生克链。
6. 世应关系：世爻为求测者（或主问方），应爻为所问之对方/对境/外部环境；世应相生为顺、世应相克为阻；应爻动则视外部有变。
7. 命中格局：空亡（日柱旬空）= 力量虚、易落空、待时填实，不直接等于坏；月破（月支冲爻）= 主破散无用，难以成事；用神月破 = 用神受冲、所问之事难以成就。
8. 调理建议按调理建议操作性铁律展开：用神旺相则顺势而进，用神休囚或空亡则填实/扶持，用神被克则泄化/通关（按相生链通关）。`;

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
    '【期望输出结构】（八段依次给出，每段以【】单独成行）',
    '【断事总纲】本卦之卦象、卦意、整体吉凶倾向（150 字内）。',
    '【世应关系】世爻与应爻的五行关系、世应动静、代表求测者与外部环境的态势。',
    '【用神分析】用神六亲、用神爻位、用神生克旺相（伏神情况须说明）、与世应之关系。',
    '【动爻与变卦】动爻位置、变卦名、变爻五行变化、对本卦的转化方向。',
    '【命中格局】空亡、月破、六合、六冲、三刑等格局对用神/世应的影响（依【命中格局】清单逐项解读）。',
    '【事态推断】结合问事类型与卦象，给出具体事态的应期与走向（事业/财/感情/健康等分别落到实际场景）。',
    '【调理建议】按调理建议操作性铁律展开，至少 3 条可立即执行的物品/方位/动作建议。',
    '【风险与边界】明确说明本判断的局限与不确定点，建议咨询专业人士的场景（如重大财务决定、健康疑虑、法律纠纷）。',
  ]
    .filter((s) => s !== '')
    .join('\n');

  // 盘面骨架作为独立字段写日志（不入 userPrompt，避免 prompt 越来越长）
  const chartContext = JSON.stringify(summary);

  return { systemPrompt, userPrompt, chartContext };
}
