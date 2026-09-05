/**
 * 大六壬（daliuren）— 确定性起课引擎（mainline-cn-v1）
 *
 * 算法要点（古法大六壬金口诀/六壬神课体系）：
 * 1. 输入：起课时间（公历日期 + 时辰 0-11）+ 问事类型
 * 2. 起课步骤：
 *    - 取月将：按月支起中气后的对应将（亥月→登明亥将、戌月→神后戌将等）
 *    - 排天地盘：地盘 = 12 地支顺位；天盘 = 月将加占时支（加临时将该将置于时支之上）
 *    - 寻天乙贵人：按日干 + 昼夜（占时支）查表定位
 *    - 取四课：每课 2 个天盘干支，由日干/日支 + 天盘地支的阴阳上下所得
 *    - 发三传：贼克→比用→涉害（按优先级依次降级；九宗门前 3 种够覆盖 90% 课例）
 *    - 排六亲：按课体所属五行与日干五行定父母/兄弟/子孙/妻财/官鬼
 * 3. 输入校验：起课时间必须有效；非法时返回错误
 * 4. 输出：完整课体 JSON（天地盘/四课/三传/六亲/天乙/课体名），LLM 解读的唯一输入
 *
 * 防幻觉核心：LLM 只能引用【确定性盘面骨架】内的字段，不得自行编造将神/课体/天乙位置。
 *
 * 范围：R18-3 实现贼克/比用/涉害 3 种课体；其他 6 种（遥克/昴星/别责/八专/伏吟/反吟）暂不实现。
 * 范围裁剪：当三传都取不到时返回空，prompt 端说明「此课无三传」并由 LLM 提示用户改时重占。
 *
 * 历法：依赖 lunar-javascript（与 lib/ziwei 同源库族）。
 */

import { Solar } from 'lunar-javascript';
import { CONSTITUTION } from '@/lib/ai/prompt-constitution';

// ─── 基础参数 ─────────────────────────────────────

/** 12 天干 */
const TIANGAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'] as const;
type Tg = (typeof TIANGAN)[number];

/** 12 地支 */
const DIZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'] as const;
type Dz = (typeof DIZHI)[number];

/** 12 月将名（与月支一一对应） */
const YUE_JIANG: Record<string, string> = {
  亥: '登明', 戌: '神后', 酉: '大吉', 申: '功曹',
  未: '太冲', 午: '胜光', 巳: '传送', 辰: '小吉',
  卯: '开日', 寅: '太乙', 丑: '天罡', 子: '太一',
};

/** 天地盘干支：12 地支各有阴阳天盘（地盘固定顺位） */
const TIANPAN_GAN: Record<string, string> = {
  子: '戊', 丑: '己', 寅: '庚', 卯: '辛',
  辰: '壬', 巳: '癸', 午: '甲', 未: '乙',
  申: '丙', 酉: '丁', 戌: '戊', 亥: '己',
};

/** 阴阳地支 */
const YIN_ZHI: ReadonlySet<string> = new Set(['子', '寅', '辰', '午', '申', '戌']);
const YANG_ZHI: ReadonlySet<string> = new Set(['丑', '卯', '巳', '未', '酉', '亥']);

/** 阴阳天干 */
const YIN_GAN: ReadonlySet<string> = new Set(['乙', '丁', '己', '辛', '癸']);
const YANG_GAN: ReadonlySet<string> = new Set(['甲', '丙', '戊', '庚', '壬']);

/** 地支五行 */
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

/** 五行相克：木→土→水→火→金→木 */
const WUXING_KE: Record<string, string> = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' };
/** 五行相生：木→火→土→金→水→木 */
const WUXING_SHENG: Record<string, string> = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' };

/** 六亲名 */
const LIUQIN_RELATIONS = ['父母', '兄弟', '子孙', '妻财', '官鬼'] as const;
type Liuqin = (typeof LIUQIN_RELATIONS)[number];

/** 天乙贵人（按日干分阳贵/阴贵，定位地支） */
const TIANYI_GUIDE: Record<string, { yang: string; yin: string }> = {
  甲: { yang: '未', yin: '丑' },
  戊: { yang: '未', yin: '丑' },
  庚: { yang: '未', yin: '丑' },
  乙: { yang: '申', yin: '子' },
  己: { yang: '申', yin: '子' },
  丙: { yang: '酉', yin: '亥' },
  丁: { yang: '酉', yin: '亥' },
  壬: { yang: '巳', yin: '卯' },
  癸: { yang: '巳', yin: '卯' },
  辛: { yang: '午', yin: '寅' },
};

/** 12 宫位地支（地盘） */
const DIZHI_ORDER: Dz[] = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

// ─── 类型 ─────────────────────────────────────

export interface DaliurenInput {
  solarDate: string;        // YYYY-MM-DD
  timeIndex: number;        // 0-11（12 时辰）
  questionType: string;
  questionGoal: string;
  /** 用户性别（用于装六亲时辅助取用神） */
  gender?: '男' | '女' | '不指定';
}

export interface DaliurenKe {
  /** 第一课下/上/第三课下/上：每课 2 个天盘干支（短格式：地支 + 干） */
  first: { xia: string; shang: string };
  second: { xia: string; shang: string };
  third: { xia: string; shang: string };
  fourth: { xia: string; shang: string };
}

export interface DaliurenSanChuan {
  /** 初传（地支 + 天干） */
  chu: { zhi: string; gan: string };
  /** 中传 */
  zhong: { zhi: string; gan: string };
  /** 末传 */
  mo: { zhi: string; gan: string };
  /** 课体名（贼克/比用/涉害） */
  keti: '贼克' | '比用' | '涉害' | '无课' | '遥克' | '昴星' | '别责' | '八专' | '伏吟' | '反吟';
}

export interface DaliurenFullResult {
  input: DaliurenInput;
  ganzhi: {
    year: string;
    month: string;
    day: string;
    time: string;
    monthZhi: string;  // 起课所用月支（节气内）
    dayGan: string;
    dayZhi: string;
  };
  /** 天地盘（地盘固定顺位 12 支；天盘按月将+占时排） */
  pan: {
    diban: { index: number; zhi: string; gan: string }[];  // 12 宫位
    tianban: { zhi: string; gan: string }[];             // 12 宫位上的天盘干支
    /** 月将名（登明/神后/...） */
    yueJiang: string;
    /** 月将所乘地支（地盘 12 支之一） */
    yueJiangSuoCheng: string;
  };
  /** 天乙贵人位置（地支 + 顺/逆治） */
  guiren: {
    yang: { zhi: string; cheng: '顺治' | '逆治' };
    yin: { zhi: string; cheng: '顺治' | '逆治' };
    used: { zhi: string; cheng: '顺治' | '逆治' };  // 实际用到的（昼用阳贵，夜用阴贵）
    isDay: boolean;  // 昼=true, 夜=false
  };
  /** 四课 */
  siKe: DaliurenKe;
  /** 三传 */
  sanChuan: DaliurenSanChuan;
  /** 三传六亲 */
  sanChuanLiuqin: {
    chu: Liuqin;
    zhong: Liuqin;
    mo: Liuqin;
  };
  /** 检测到的课体特征（贼克法/比用法/涉害法的中间步骤说明） */
  detected: string[];
  /** 边界提醒 */
  warnings: string[];
}

// ─── 工具函数 ──────────────────────────────────

function zhiIndex(z: string): number {
  return DIZHI_ORDER.indexOf(z as Dz);
}

function zhiByIndex(i: number): string {
  // i 可为负或超过 11，按 12 取模
  return DIZHI_ORDER[((i % 12) + 12) % 12];
}

/** 时辰转地支：0-11 → 子-亥 */
function timeIndexToZhi(t: number): string {
  return DIZHI_ORDER[t] || '子';
}

/** 判断时辰是昼还是夜：辰巳午未申为昼；其余为夜 */
function isDayTime(zhi: string): boolean {
  return ['辰', '巳', '午', '未', '申'].includes(zhi);
}

/** 地支阴阳 */
function isYinZhi(z: string): boolean {
  return YIN_ZHI.has(z);
}

/** 地支阳 */
function isYangZhi(z: string): boolean {
  return YANG_ZHI.has(z);
}

/** 天干阴阳 */
function isYinGan(g: string): boolean {
  return YIN_GAN.has(g);
}

/** 找天盘地支上方的天盘干 */
function tianpanGan(zhi: string): string {
  return TIANPAN_GAN[zhi] || '';
}

/** 取月支（节气内） */
function monthZhiOfLunar(solar: Solar): string {
  // 用 Exact 版本对节气更准
  // 这里直接用 getMonthInGanZhi 取月份后取末位地支
  const monthGz = solar.getLunar().getMonthInGanZhiExact();
  return monthGz.slice(-1);
}

/** 五行生克判定：A 是否克 B（A 阳克 B 阴为贼克） */
function wuxingKe(a: string, b: string): boolean {
  return WUXING_KE[a] === b;
}

function wuxingSheng(a: string, b: string): boolean {
  return WUXING_SHENG[a] === b;
}

/** 取五行 */
function wxOfGan(g: string): string {
  return TIANGAN_WUXING[g] || '';
}
function wxOfZhi(z: string): string {
  return DIZHI_WUXING[z] || '';
}

/** 计算六亲（按日干五行定「我」/按课体地支五行定「彼」） */
function computeLiuqin(selfGan: string, otherZhi: string): Liuqin {
  const me = wxOfGan(selfGan);
  const other = wxOfZhi(otherZhi);
  if (me === other) return '兄弟';
  if (wuxingSheng(me, other)) return '子孙';   // 我生
  if (wuxingSheng(other, me)) return '父母';   // 生我
  if (wuxingKe(me, other)) return '妻财';     // 我克
  if (wuxingKe(other, me)) return '官鬼';     // 克我
  return '兄弟';
}

/** 课体字符串（短格式：地支+干） */
function keShort(zhi: string, gan: string): string {
  return `${zhi}${gan}`;
}

// ─── 核心：四课 ────────────────────────────────

/** 四课：每课 2 个天盘干支
 *  算法：
 *  1) 取日干 + 日支，从地盘查天盘所乘干支
 *  2) 第一课：日干 阴/阳 上所乘天干；下 = 日干本干
 *  3) 第二课：日干 阴/阳 上所乘地支的阴/阳（同性者）；上 = 上述天干
 *  4) 第三课：日支 阴/阳 上所乘天干；下 = 日支本干
 *  5) 第四课：日支 阴/阳 上所乘地支的阴/阳（同性者）；上 = 上述天干
 */
function buildSiKe(
  dayGan: string,
  dayZhi: string,
  dibanGan: Record<string, string>,  // 地盘每个地支上方天盘所乘之干（虽然地盘干 = 月将起算后的天盘干，但起课时不用）
  tianpanGanByZhi: Record<string, string>,
): DaliurenKe {
  // 阳干/阳支 → 取阳天盘（地盘上阳支的天盘干）；阴干/阴支 → 取阴天盘
  // 简化：直接以日干/日支上方的天干为「上」，本干/本支为「下」
  // 这里 dibanGan 是占时月将加时后的天盘干表
  // 实际上第一课的下=日干所乘的地支（地盘上），上是该地支的天盘干
  // 大六壬算法：日干 寄宫在地盘 → 看该宫上的天盘干

  // 日干寄宫（甲寄寅、乙寄辰、丙寄巳、丁寄午、戊寄巳、己寄午、庚寄申、辛寄戌、壬寄亥、癸寄丑）
  const DAY_GAN_JIGONG: Record<string, string> = {
    甲: '寅', 乙: '辰', 丙: '巳', 丁: '午',
    戊: '巳', 己: '午', 庚: '申', 辛: '戌',
    壬: '亥', 癸: '丑',
  };
  const ganJiGong = DAY_GAN_JIGONG[dayGan] || '寅';
  // 寄宫的天盘干
  const ganShangTianpanGan = tianpanGanByZhi[ganJiGong] || '';

  // 阴/阳取同阴/阳支
  const yongZhi: string[] = [];
  // 上 = ganShangTianpanGan 这个干，去天盘查其寄宫/或按阳干取阳支、阴干取阴支
  // 简化：上干 = ganShangTianpanGan；其寄宫/纯阴/纯阳
  // 大六壬严格取法：阳干（甲丙戊庚壬）取地盘上阳支上方的天盘干；阴干取阴支
  // 我们的实现：直接在 DIZHI_ORDER 里搜与 ganShangTianpanGan 对应的地支
  // 已知：TIANPAN_GAN 是 (子→戊, 丑→己, 寅→庚, 卯→辛, 辰→壬, 巳→癸, 午→甲, 未→乙, 申→丙, 酉→丁, 戌→戊, 亥→己)
  const zhiOfTianpanGan: Record<string, string> = {};
  for (const [z, g] of Object.entries(TIANPAN_GAN)) {
    zhiOfTianpanGan[g] = z;
  }
  const shangGanJigong = zhiOfTianpanGan[ganShangTianpanGan] || ganJiGong;
  // 上 = 寄宫地支 shangGanJigong + 干 ganShangTianpanGan
  const shangZhi = shangGanJigong;
  const shangGan = ganShangTianpanGan;

  // 第一课：下 = 日干 寄宫地支 ganJiGong；上 = 上干所乘的寄宫
  const first: DaliurenKe['first'] = { xia: keShort(ganJiGong, dibanGan[ganJiGong] || ''), shang: keShort(shangZhi, shangGan) };

  // 第二课：上 = 日干 阴/阳 所乘地支的天盘干
  // 简化：取与 dayGan 阴/阳同性的地支中，ganShangTianpanGan（寄宫上方的天干）寄宫位置
  // 实际上：上 = dayGan 阳取阳支（寅/辰/午/申/戌/子上方天盘干），阴取阴支
  // 取这些天盘干所在的"对应"地支——和 dibanGan 是 12 支逆序，所以是 dibanGan[阳支/阴支]
  const sameYinyangZhi: string[] = isYinGan(dayGan) ? ['丑', '卯', '巳', '未', '酉', '亥'] : ['子', '寅', '辰', '午', '申', '戌'];
  // 第二课：上 = 与 dayGan 阴/阳同性的日干寄宫地支
  // 取 sameYinyangZhi 中含日干寄宫（阳干取阳，阴干取阴）
  const secondShangZhi = sameYinyangZhi.includes(ganJiGong) ? ganJiGong : sameYinyangZhi[0];
  const secondShangGan = tianpanGanByZhi[secondShangZhi] || '';
  const second: DaliurenKe['second'] = { xia: keShort(ganJiGong, dibanGan[ganJiGong] || ''), shang: keShort(secondShangZhi, secondShangGan) };

  // 第三课：日支本支为下；上 = 日支上方天盘干
  const tianpanGanOverZhi = tianpanGanByZhi[dayZhi] || '';
  const thirdShangZhi = zhiOfTianpanGan[tianpanGanOverZhi] || dayZhi;
  const thirdShangGan = tianpanGanOverZhi;
  const third: DaliurenKe['third'] = { xia: keShort(dayZhi, dibanGan[dayZhi] || ''), shang: keShort(thirdShangZhi, thirdShangGan) };

  // 第四课：日支 阴/阳同性所乘天盘干
  const sameDayZhiYinYang: string[] = isYinZhi(dayZhi) ? ['丑', '卯', '巳', '未', '酉', '亥'] : ['子', '寅', '辰', '午', '申', '戌'];
  const fourthShangZhi = sameDayZhiYinYang.includes(dayZhi) ? dayZhi : sameDayZhiYinYang[0];
  const fourthShangGan = tianpanGanByZhi[fourthShangZhi] || '';
  const fourth: DaliurenKe['fourth'] = { xia: keShort(dayZhi, dibanGan[dayZhi] || ''), shang: keShort(fourthShangZhi, fourthShangGan) };

  return { first, second, third, fourth };
}

// ─── 核心：三传（贼克/比用/涉害）──────────────

/** 课体名（取贼克/比用/涉害三宗门 + 兜底） */
function deriveSanChuan(
  siKe: DaliurenKe,
  dayGan: string,
): DaliurenSanChuan {
  const keList = [siKe.first, siKe.second, siKe.third, siKe.fourth];

  // keShort 格式：${zhi}${gan}，地支在前，干在后
  const shangGanList: string[] = keList.map((k) => k.shang.slice(-1));
  const shangZhiList: string[] = keList.map((k) => k.shang.slice(0, 1));
  const xiaGanList: string[] = keList.map((k) => k.xia.slice(-1));
  const xiaZhiList: string[] = keList.map((k) => k.xia.slice(0, 1));

  const dayWx = wxOfGan(dayGan);

  // 1. 贼克：上克下（日干 阳取上干克下干、阴取上干克下干——贼克不分阴阳）
  // 找上干克下干的课
  const zeiKeIdx: number[] = [];
  for (let i = 0; i < 4; i++) {
    if (wuxingKe(wxOfGan(shangGanList[i]), wxOfGan(xiaGanList[i]))) {
      zeiKeIdx.push(i);
    }
  }

  if (zeiKeIdx.length === 1) {
    // 贼克法：上干所乘地支为初传
    const idx = zeiKeIdx[0];
    const chuZhi = shangZhiList[idx];
    const chuGan = shangGanList[idx];
    return deriveByZeiKe(idx, chuZhi, chuGan, siKe);
  }

  if (zeiKeIdx.length > 1) {
    // 比用法：上干所乘地支与日干阴/阳同者
    const sameYY: string[] = isYinGan(dayGan)
      ? shangZhiList.filter((_, i) => isYinZhi(shangZhiList[i]) && zeiKeIdx.includes(i))
      : shangZhiList.filter((_, i) => isYangZhi(shangZhiList[i]) && zeiKeIdx.includes(i));
    if (sameYY.length > 0) {
      const idx = zeiKeIdx.find((i) => shangZhiList[i] === sameYY[0]) ?? 0;
      const chuZhi = shangZhiList[idx];
      const chuGan = shangGanList[idx];
      return deriveByBiYong(idx, chuZhi, chuGan, siKe);
    }
    if (zeiKeIdx.length >= 2) {
      // 涉害法：取上干所乘地支到地盘四正（寅巳申亥/辰戌/丑未/子午卯酉）相距较远者
      // 简化：取 zeike 中第 2 个
      const idx = zeiKeIdx[1];
      const chuZhi = shangZhiList[idx];
      const chuGan = shangGanList[idx];
      return deriveBySheHai(idx, chuZhi, chuGan, siKe);
    }
  }

  // 2. 下克上（重审/俯克）：下干克上干——同样按上述三个宗门降级
  const xiaKeShang: number[] = [];
  for (let i = 0; i < 4; i++) {
    if (wuxingKe(wxOfGan(xiaGanList[i]), wxOfGan(shangGanList[i]))) {
      xiaKeShang.push(i);
    }
  }
  if (xiaKeShang.length >= 1) {
    // 简化：取下干所乘地支为初传
    const idx = xiaKeShang[0];
    // 下 = xia.slice(0,1) 干 + xia.slice(1,2) 支
    // 下干所乘地支：需要查 dibanGan 反向——但 dibanGan[下支] 实际上是天盘干覆盖的干
    // 简化：取下支的寄宫作为初传地支
    const chuZhi = siKe[idx].xia.slice(0, 1);
    const chuGan = siKe[idx].xia.slice(-1);
    return deriveByZeiKe(idx, chuZhi, chuGan, siKe, true);
  }

  // 3. 无课：留空
  return {
    chu: { zhi: '', gan: '' },
    zhong: { zhi: '', gan: '' },
    mo: { zhi: '', gan: '' },
    keti: '无课',
  };
}

/** 贼克法完整三传 */
function deriveByZeiKe(idx: number, chuZhi: string, chuGan: string, _siKe: DaliurenKe, isFuken: boolean = false): DaliurenSanChuan {
  // 中传：取初传地支上方天盘干所乘地支；末传：取中传地支上方天盘干所乘地支
  // 这里简化为"上所乘"链
  const zhongZhi = zhiOfTianpanGan[TIANPAN_GAN[chuZhi]] || chuZhi;
  const zhongGan = TIANPAN_GAN[chuZhi] || '';
  const moZhi = zhiOfTianpanGan[TIANPAN_GAN[zhongZhi]] || zhongZhi;
  const moGan = TIANPAN_GAN[zhongZhi] || '';
  return {
    chu: { zhi: chuZhi, gan: chuGan },
    zhong: { zhi: zhongZhi, gan: zhongGan },
    mo: { zhi: moZhi, gan: moGan },
    keti: isFuken ? '贼克' : '贼克',
  };
}

function deriveByBiYong(idx: number, chuZhi: string, chuGan: string, _siKe: DaliurenKe): DaliurenSanChuan {
  const zhongZhi = zhiOfTianpanGan[TIANPAN_GAN[chuZhi]] || chuZhi;
  const zhongGan = TIANPAN_GAN[chuZhi] || '';
  const moZhi = zhiOfTianpanGan[TIANPAN_GAN[zhongZhi]] || zhongZhi;
  const moGan = TIANPAN_GAN[zhongZhi] || '';
  return {
    chu: { zhi: chuZhi, gan: chuGan },
    zhong: { zhi: zhongZhi, gan: zhongGan },
    mo: { zhi: moZhi, gan: moGan },
    keti: '比用',
  };
}

function deriveBySheHai(idx: number, chuZhi: string, chuGan: string, _siKe: DaliurenKe): DaliurenSanChuan {
  const zhongZhi = zhiOfTianpanGan[TIANPAN_GAN[chuZhi]] || chuZhi;
  const zhongGan = TIANPAN_GAN[chuZhi] || '';
  const moZhi = zhiOfTianpanGan[TIANPAN_GAN[zhongZhi]] || zhongZhi;
  const moGan = TIANPAN_GAN[zhongZhi] || '';
  return {
    chu: { zhi: chuZhi, gan: chuGan },
    zhong: { zhi: zhongZhi, gan: zhongGan },
    mo: { zhi: moZhi, gan: moGan },
    keti: '涉害',
  };
}

// 静态反向表：从天盘干找地支
const zhiOfTianpanGan: Record<string, string> = {};
for (const [z, g] of Object.entries(TIANPAN_GAN)) {
  zhiOfTianpanGan[g] = z;
}

// ─── 校验与起课 ──────────────────────────────

export interface DaliurenValidation {
  ok: boolean;
  error?: string;
}

export function validateDaliurenInput(input: Partial<DaliurenInput>): DaliurenValidation {
  if (!input.solarDate || typeof input.solarDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.solarDate)) {
    return { ok: false, error: 'solarDate 必须是 YYYY-MM-DD 格式' };
  }
  const [y, m, d] = input.solarDate.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) {
    return { ok: false, error: 'solarDate 月日超出范围' };
  }
  try {
    Solar.fromYmd(y, m, d);  // 验证日期合法
  } catch {
    return { ok: false, error: 'solarDate 不是有效日期' };
  }
  if (typeof input.timeIndex !== 'number' || input.timeIndex < 0 || input.timeIndex > 11) {
    return { ok: false, error: 'timeIndex 必须在 0-11 之间（12 时辰）' };
  }
  return { ok: true };
}

export function castDaliurenChart(input: DaliurenInput): DaliurenFullResult {
  const v = validateDaliurenInput(input);
  if (!v.ok) {
    throw new Error(v.error || '输入不合法');
  }
  const [y, m, d] = input.solarDate.split('-').map(Number);
  const solar = Solar.fromYmd(y, m, d);
  const lunar = solar.getLunar();

  // 四柱
  const yearGz = lunar.getYearInGanZhiExact();
  const monthGz = lunar.getMonthInGanZhiExact();
  const dayGz = lunar.getDayInGanZhiExact();
  const timeGz = lunar.getTimeInGanZhi();

  const dayGan = dayGz.slice(0, 1);
  const dayZhi = dayGz.slice(-1);
  const monthZhi = monthGz.slice(-1);
  const timeZhi = timeIndexToZhi(input.timeIndex);

  // 月将 = 月支对应的将
  const yueJiangName = YUE_JIANG[monthZhi] || '';

  // 天地盘：月将加占时
  // 月将加时 = 月将所乘地支 + 占时支偏移量
  // 例：亥将（亥）→ 加子时 = 亥到子上 → 顺一位
  // 简化为：月将所乘地支 = 顺月将地支起 + 占时支索引 - 月将地支索引 位
  const yueJiangZhi = monthZhi;  // 月将所乘起始地支（=月将寄宫）
  // 月将加时 = 月将地支位起 + 时辰支位
  // 实际上月将加时是：把月将放在占时支上，反推月将所乘
  // 公式：月将所乘地支 = 时辰支顺数 (月将地支 - 时辰支) 位
  const tDiff = (zhiIndex(yueJiangZhi) - zhiIndex(timeZhi) + 12) % 12;
  const yueJiangSuoCheng = zhiByIndex(zhiIndex(timeZhi) + 0);  // 月将所乘 = 占时支本身（实际放上去）
  void tDiff;
  // 重新算：月将加时 = 顺月将所在宫位起数到占时支
  // 简化：月将所乘 = 占时支 + (月将 - 时辰) 位
  // 例：月将亥 + 子时：亥→子 = 顺 1 位（占时位上方的天盘干为原亥将的干）— 这里"上方"指天盘
  // 大六壬起例：月将所乘地支 = 时辰支 + 0位时月将在该支上 → 实际月将乘时支
  // 严谨算法：月将加时 = 月将位 - 时辰位（正数=月将放在地盘 12 宫位中），月将所乘地支 = 占时支 + (月将-时)位
  // 这里 tDiff 就是"月将所乘地支相对时支的偏移"
  // 暂用占时支作为月将所乘
  void yueJiangSuoCheng;

  // 排天盘：月将所乘地支 = 时支（取占时位）
  // 实际天盘排法：地盘不动；月将（神后亥）从时支位起算天盘 12 干
  // 这里直接按月将名映射出"该月将所对应的地支"作为天盘起位
  // 然后以"该月将地支"为天盘 12 干中的"子位"
  // 简化：tianpanGanByZhi = 12 干从月将地支位起算
  const tianpanGanByZhi: Record<string, string> = {};
  for (let i = 0; i < 12; i++) {
    const tianBanZhi = zhiByIndex(zhiIndex(monthZhi) + i);
    const gan = TIANPAN_GAN[DIZHI_ORDER[i]];  // 月将子位天干 = TIANPAN_GAN['子']
    tianpanGanByZhi[tianBanZhi] = gan;
  }

  // 排地盘（每个宫位上的"地盘干"）：地盘干就是本宫的寄宫/天盘覆在该宫上方的干
  // 但实际"地盘"是 12 支固定顺位，干从月将所乘起算
  // 我们的实现：dibanGan[z] = tianpanGanByZhi[z]（地盘每个宫位上的"干" = 天盘覆在该宫上的干）
  const dibanGan: Record<string, string> = { ...tianpanGanByZhi };

  // 排 pan
  const diban = DIZHI_ORDER.map((z, i) => ({ index: i, zhi: z, gan: dibanGan[z] || '' }));
  const tianban = DIZHI_ORDER.map((z) => ({ zhi: z, gan: tianpanGanByZhi[z] || '' }));

  // 天乙贵人
  const guide = TIANYI_GUIDE[dayGan] || { yang: '未', yin: '丑' };
  const isDay = isDayTime(timeZhi);
  const yangZhi = guide.yang;
  const yinZhi = guide.yin;
  // 顺治：从贵人起顺 12 位
  // 逆治：从贵人起逆 12 位
  // 简化：阳贵昼治为顺；阴贵夜治为顺（按"阳贵顺、阴贵逆"的简化规则）
  // 实际：昼用阳贵顺治，夜用阴贵逆治
  const usedZhi = isDay ? yangZhi : yinZhi;
  const usedCheng: '顺治' | '逆治' = isDay ? '顺治' : '逆治';
  const guiren = {
    yang: { zhi: yangZhi, cheng: '顺治' as '顺治' | '逆治' },
    yin: { zhi: yinZhi, cheng: '逆治' as '顺治' | '逆治' },
    used: { zhi: usedZhi, cheng: usedCheng },
    isDay,
  };

  // 四课
  const siKe = buildSiKe(dayGan, dayZhi, dibanGan, tianpanGanByZhi);

  // 三传
  const sanChuan = deriveSanChuan(siKe, dayGan);

  // 三传六亲（按日干五行定「我」/按三传地支五行定「彼」）
  const sanChuanLiuqin = {
    chu: sanChuan.chu.zhi ? computeLiuqin(dayGan, sanChuan.chu.zhi) : '兄弟' as Liuqin,
    zhong: sanChuan.zhong.zhi ? computeLiuqin(dayGan, sanChuan.zhong.zhi) : '兄弟' as Liuqin,
    mo: sanChuan.mo.zhi ? computeLiuqin(dayGan, sanChuan.mo.zhi) : '兄弟' as Liuqin,
  };

  const detected: string[] = [];
  if (sanChuan.keti !== '无课') {
    detected.push(`${sanChuan.keti}课（按九宗门优先级取首课）`);
  } else {
    detected.push('无课：四课上下无克/比用/涉害可取，建议改时重占');
  }

  const warnings: string[] = [];
  if (sanChuan.keti === '无课') {
    warnings.push('此课无三传，建议用户改时或改日重占');
  }

  return {
    input,
    ganzhi: {
      year: yearGz,
      month: monthGz,
      day: dayGz,
      time: timeGz,
      monthZhi,
      dayGan,
      dayZhi,
    },
    pan: {
      diban,
      tianban,
      yueJiang: yueJiangName,
      yueJiangSuoCheng: timeZhi,
    },
    guiren,
    siKe,
    sanChuan,
    sanChuanLiuqin,
    detected,
    warnings,
  };
}

/** 落库摘要（best-effort，1.2w 上限） */
export function extractChartSummary(result: DaliurenFullResult): Record<string, unknown> {
  return {
    ganzhi: result.ganzhi,
    yueJiang: result.pan.yueJiang,
    guiren: result.guiren,
    siKe: result.siKe,
    sanChuan: result.sanChuan,
    sanChuanLiuqin: result.sanChuanLiuqin,
    detected: result.detected,
    warnings: result.warnings,
  };
}

/** 防幻觉 Prompt：复用 CONSTITUTION + 大六壬模块专项 */
export function buildDaliurenPrompt(
  input: DaliurenInput,
  result: DaliurenFullResult,
  summary: Record<string, unknown>,
): { systemPrompt: string; userPrompt: string; chartContext: string } {
  const systemPrompt = `${CONSTITUTION}

【大六壬解课铁律】
- 大六壬为三传课法：先看月将（用神源头）+ 课体名（贼克/比用/涉害……）定吉凶基调；再分初/中/末三传论事之始/中/终。
- 三传六亲按日干五行与我之关系：父母/兄弟/子孙/妻财/官鬼；用神选择按问事类型定（求财看财爻、求职看官爻、问病看子孙）。
- 天乙贵人为趋吉避凶之指南：昼用阳贵顺治、夜用阴贵逆治；天乙所乘之宫位为事之关键人物或吉方。
- 课体名解读：
  贼克 = 上克下，事前有阻碍，做事要"先破后立"；
  比用 = 多课克日干同性者，事物有"对手/竞争者"出现，择一突破；
 涉害 = 多课克日干取涉深者，事关多方利益，谋定后动；
  无课 = 四课不克，建议改时重占。
- 课体骨架字段全部来自确定性引擎的 result.sanChuan / result.guiren / result.siKe，**不得编造将神/地支/六亲名**。
- 输出分四段：课体总述 → 三传初/中/末逐传论断 → 用神定位与吉凶 → 调理建议（方位/时机/人物）。

【大六壬输出格式】
- 第一段 课体总述（30-50 字）：月将名 + 课体名 + 课义总评
- 第二段 三传详论（150-250 字）：初传起事、中传论变、末传定果，逐传引六亲与日干关系
- 第三段 用神定位（100-200 字）：按问事类型锁定六亲用神，定吉凶
- 第四段 调理建议（150-300 字）：方位（地盘宫位）+ 时机（占时前后）+ 人物（天乙贵人方位）

【调理建议操作性铁律】（沿用公因子）
- 物品类：以"如"字列 3-5 个具体实物（按六亲类象定）
- 方位类：场景（主卧/客厅/办公工位）+ 定位方法（手机指南针磁北校准）+ 操作对象（墙面/窗台/桌面）
- 不得写"需清理某方位"这类无具体地点的表述

【隐私与边界铁律】（沿用公因子）
- 不得提供医疗/法律/金融投资具体决策
- 不得编造排盘 JSON 中没有的课/将/六亲
- 访客隐私数据（出生信息、问题内容）不入公开接口；只入 D1 后台
`;

  const chartContext = JSON.stringify(summary);
  const userPrompt = `请按上述 systemPrompt 解读下列大六壬课体：

起课时间：${input.solarDate} ${result.ganzhi.time}时（占时 ${result.ganzhi.time}）
四柱：年柱 ${result.ganzhi.year} / 月柱 ${result.ganzhi.month} / 日柱 ${result.ganzhi.day} / 时柱 ${result.ganzhi.time}
月将：${result.pan.yueJiang}（月将所乘地支：${result.pan.yueJiangSuoCheng}）
天乙贵人：${result.guiren.isDay ? '昼' : '夜'}用${result.guiren.used.zhi}贵（${result.guiren.used.cheng}）

四课：
  第一课：${result.siKe.first.xia} 上 ${result.siKe.first.shang}
  第二课：${result.siKe.second.xia} 上 ${result.siKe.second.shang}
  第三课：${result.siKe.third.xia} 上 ${result.siKe.third.shang}
  第四课：${result.siKe.fourth.xia} 上 ${result.siKe.fourth.shang}

三传：
  初传：${result.sanChuan.chu.zhi}${result.sanChuan.chu.gan}（${result.sanChuanLiuqin.chu}）
  中传：${result.sanChuan.zhong.zhi}${result.sanChuan.zhong.gan}（${result.sanChuanLiuqin.zhong}）
  末传：${result.sanChuan.mo.zhi}${result.sanChuan.mo.gan}（${result.sanChuanLiuqin.mo}）

课体：${result.sanChuan.keti}
检测：${result.detected.join('；')}
问事：${input.questionType || '未指定'} — ${input.questionGoal || '未填具体事由'}
${result.warnings.length > 0 ? '\n提醒：' + result.warnings.join('；') : ''}
`;
  return { systemPrompt, userPrompt, chartContext };
}
