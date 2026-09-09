/**
 * 六爻深度分析 — 旺衰 / 作用 / 五神 / 应期 / 伏神
 *
 * 口径来源（两个参考项目的共识口径，已交叉验证一致）：
 * - songgoldenwind-crypto/liuyao-skills  references/01-power-order.md、02-interactions.md、03-subject-timing.md
 * - shubhaviatiningsih-byte/fortune-liuyao-skill  scripts/liuyao_core.py
 *
 * 核心原则（与"加减法评旺衰"的流派区分开）：
 * 1. 原月令决定旺衰（旺相休囚死），原日辰决定生克冲合与最终成败；二者职责不混。
 * 2. 旺衰与强弱分开：旺衰由月令定（得令为旺），强弱由日辰/变爻/动爻是否生助定。
 *    旺爻受克仍叫旺，衰爻受生仍叫衰——变化的是强弱与实际能否作用。
 * 3. 四级权限：日辰 > 变爻 > 动爻/暗动 > 静爻。静爻有作用之意、无主动生克力。
 * 4. 三阶段顺序：本卦内部 → 变爻作用 → 日辰裁决。顺序不等于权限。
 * 5. 不用"五行耗泄"，不以日月同权做加减法。
 * 6. 欲成欲散决定五神利害：吉用（想成）原神吉忌神凶；凶用（想散）反之。
 *
 * 本模块只做"确定性计算"，不产出吉凶断语——吉凶由 LLM 在 prompt 骨架上按口径叙述。
 */

// ─── 基础常量 ────────────────────────────────────────────

/** 地支五行 */
export const DIZHI_WUXING: Record<string, string> = {
  子: '水', 亥: '水',
  寅: '木', 卯: '木',
  巳: '火', 午: '火',
  申: '金', 酉: '金',
  辰: '土', 戌: '土', 丑: '土', 未: '土',
};

/** 五行相生：木→火→土→金→水→木 */
const SHENG: Record<string, string> = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' };
/** 五行相克：木→土→水→火→金→木 */
const KE: Record<string, string> = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' };

/** 六冲：子午、丑未、寅申、卯酉、辰戌、巳亥 */
const CLASH: Record<string, string> = {
  子: '午', 午: '子', 丑: '未', 未: '丑', 寅: '申', 申: '寅',
  卯: '酉', 酉: '卯', 辰: '戌', 戌: '辰', 巳: '亥', 亥: '巳',
};

/** 六合：子丑、寅亥、卯戌、辰酉、巳申、午未 */
const HARMONY: Record<string, string> = {
  子: '丑', 丑: '子', 寅: '亥', 亥: '寅', 卯: '戌', 戌: '卯',
  辰: '酉', 酉: '辰', 巳: '申', 申: '巳', 午: '未', 未: '午',
};

/** 三合局：申子辰水、亥卯未木、寅午戌火、巳酉丑金 */
const THREE_HARMONY: Array<{ branches: [string, string, string]; element: string }> = [
  { branches: ['申', '子', '辰'], element: '水' },
  { branches: ['亥', '卯', '未'], element: '木' },
  { branches: ['寅', '午', '戌'], element: '火' },
  { branches: ['巳', '酉', '丑'], element: '金' },
];

/** 三刑组：寅巳申（无恩之刑）、丑戌未（恃势之刑） */
const PUNISH_GROUPS: string[][] = [['寅', '巳', '申'], ['丑', '戌', '未']];
/** 自刑：辰午酉亥 */
const SELF_PUNISH = ['辰', '午', '酉', '亥'];

/** 六害：子未、丑午、寅巳、卯辰、申亥、酉戌 */
const HARM: Record<string, string> = {
  子: '未', 未: '子', 丑: '午', 午: '丑', 寅: '巳', 巳: '寅',
  卯: '辰', 辰: '卯', 申: '亥', 亥: '申', 酉: '戌', 戌: '酉',
};

/** 六破：子酉、丑辰、寅亥、卯午、巳申、未戌 */
const BREAK: Record<string, string> = {
  子: '酉', 酉: '子', 丑: '辰', 辰: '丑', 寅: '亥', 亥: '寅',
  卯: '午', 午: '卯', 巳: '申', 申: '巳', 未: '戌', 戌: '未',
};

/** 进神：地支化进（亥化子、寅化卯、巳化午、申化酉、丑化辰、辰化未、未化戌） */
const ADVANCE: Record<string, string> = {
  亥: '子', 寅: '卯', 巳: '午', 申: '酉', 丑: '辰', 辰: '未', 未: '戌',
};
/** 退神：进神的反向 */
const RETREAT: Record<string, string> = Object.fromEntries(
  Object.entries(ADVANCE).map(([from, to]) => [to, from]),
);

/**
 * 月令旺相休囚死表。
 * 行=五行，列=季节令（春木/夏火/秋金/冬水/土令）。
 * 土令指辰戌丑未月（三六九十二月）。
 */
const MONTH_POWER: Record<string, Record<string, string>> = {
  木: { 春: '旺', 夏: '休', 土令: '囚', 秋: '死', 冬: '相' },
  火: { 春: '相', 夏: '旺', 土令: '休', 秋: '囚', 冬: '死' },
  土: { 春: '死', 夏: '相', 土令: '旺', 秋: '休', 冬: '囚' },
  金: { 春: '囚', 夏: '死', 土令: '相', 秋: '旺', 冬: '休' },
  水: { 春: '休', 夏: '囚', 土令: '死', 秋: '相', 冬: '旺' },
};

/** 月支 → 季节令（土令=辰戌丑未月） */
function monthBranchToSeason(monthZhi: string): string {
  if (monthZhi === '辰' || monthZhi === '戌' || monthZhi === '丑' || monthZhi === '未') return '土令';
  if (monthZhi === '寅' || monthZhi === '卯') return '春';
  if (monthZhi === '巳' || monthZhi === '午') return '夏';
  if (monthZhi === '申' || monthZhi === '酉') return '秋';
  return '冬'; // 亥子
}

// ─── 类型 ────────────────────────────────────────────

/** 单爻的旺衰与状态 */
export interface YaoAnalysis {
  position: number;
  zhi: string;
  wuxing: string;
  /** 月令旺衰：旺/相/休/囚/死 */
  monthPower: string;
  /** 是否得令（旺/相） */
  isDeshi: boolean;
  /** 日辰对本地支的作用：生/克/冲/合/无 */
  dayRelation: string;
  /** 日辰是否生助本爻（日生或日合） */
  daySupports: boolean;
  /** 日辰是否克制本爻（日克或日冲带克） */
  dayPresses: boolean;
  /** 强弱结论（旺衰由月令定，强弱由日辰/动变生助定） */
  strength: '强' | '弱' | '中';
  /** 空亡状态：无/暂空/真亡 */
  voidState: '无' | '暂空' | '真亡';
  /** 是否月破（本地支与月支相冲） */
  isMonthBreak: boolean;
  /** 是否暗动（日辰冲非空静爻） */
  isAnDong: boolean;
  /** 是否日破（日辰冲动爻，或日冲变爻） */
  isDayBreak: boolean;
  /** 入墓地支（十二长生中日支墓本地支），无则空串 */
  graveZhi: string;
  /** 动爻化进/化退（仅动爻有） */
  jinTui?: '化进' | '化退' | '';
  /** 回头关系（变爻对原动爻：回生/回克/回冲/回合/无） */
  huiTou?: string;
}

/** 五神（用神/原神/忌神/仇神/喜神） */
export interface FiveShen {
  /** 用神六亲 */
  yongShen: string;
  /** 原神（生用神者） */
  yuanShen: string;
  /** 忌神（克用神者） */
  jiShen: string;
  /** 仇神（生忌神且克原神者） */
  chouShen: string;
  /** 喜神（克忌神者） */
  xiShen: string;
  /** 欲成欲散口径：吉用（想成/想得）or 凶用（想散/想败） */
  intent: '吉用' | '凶用';
  /** 各神在当前口径下的利害（吉用时原神喜神吉、忌神仇神凶；凶用反之） */
  lihai: Record<string, '吉' | '凶'>;
}

/** 应期候选 */
export interface TimingCandidate {
  mechanism: string;
  triggerBranch: string;
  meaning: string;
  /** 触发快慢：快（冲/现/动）or 慢（合/静/伏） */
  speed: '快' | '慢';
}

/** 伏神信息 */
export interface FuShenInfo {
  /** 伏神六亲 */
  liuqin: string;
  /** 伏神所在本宫爻位 */
  position: number;
  /** 伏神地支 */
  zhi: string;
  /** 飞爻（覆盖它的本卦爻）位置 */
  feiPosition: number;
  /** 飞爻地支 */
  feiZhi: string;
  /** 能否出伏（开伏/闭伏） */
  state: '开伏' | '闭伏';
  /** 判定理由 */
  reason: string;
}

/** 格局命中项 */
export interface PatternHit {
  name: string;
  nature: '吉' | '凶' | '中性';
  note: string;
}

// ─── 旺衰计算 ────────────────────────────────────────────

/**
 * 月令旺衰：五行在当月令下的旺/相/休/囚/死。
 * @param wuxing 爻地支五行
 * @param monthZhi 月支（如 '寅'）
 */
export function monthPowerOf(wuxing: string, monthZhi: string): string {
  const season = monthBranchToSeason(monthZhi);
  return MONTH_POWER[wuxing]?.[season] || '休';
}

/** 是否得令（旺或相） */
export function isDeshi(wuxing: string, monthZhi: string): boolean {
  const p = monthPowerOf(wuxing, monthZhi);
  return p === '旺' || p === '相';
}

/** 日辰对爻地支的作用关系 */
export function dayRelationOf(dayZhi: string, yaoZhi: string): string {
  if (dayZhi === yaoZhi) return '值';
  if (CLASH[dayZhi] === yaoZhi) return '冲';
  if (HARMONY[dayZhi] === yaoZhi) return '合';
  const dayWx = DIZHI_WUXING[dayZhi];
  const yaoWx = DIZHI_WUXING[yaoZhi];
  if (SHENG[dayWx] === yaoWx) return '生';
  if (KE[dayWx] === yaoWx) return '克';
  if (SHENG[yaoWx] === dayWx) return '被生';
  if (KE[yaoWx] === dayWx) return '被克';
  return '无';
}

/** 十二长生墓位（土不用长生，此处仅取墓供象，不据墓剥夺受生） */
const GRAVE_OF: Record<string, string> = {
  木: '未', 火: '戌', 金: '丑', 水: '辰',
};

/** 入墓：日支为本地支五行之墓 */
export function graveOf(dayZhi: string, yaoWuxing: string): string {
  const g = GRAVE_OF[yaoWuxing];
  return dayZhi === g ? g : '';
}

// ─── 主分析入口 ────────────────────────────────────────────

export interface AnalysisInput {
  /** 六爻明细：position 1-6、zhi、isDong、bianZhi（动爻变爻地支）、liuqin */
  yaos: Array<{
    position: number;
    zhi: string;
    liuqin: string;
    isDong: boolean;
    bianZhi?: string;
    isShi?: boolean;
    isYing?: boolean;
  }>;
  /** 月支（如 '寅'） */
  monthZhi: string;
  /** 日支（如 '午'） */
  dayZhi: string;
  /** 旬空地支数组（如 ['戌','亥']） */
  kongWang: string[];
  /** 用神六亲（如 '妻财'） */
  yongShenLiuqin: string;
  /** 问事意图：吉用（想成/想得）or 凶用（想散/想败） */
  intent?: '吉用' | '凶用';
  /** 本卦所属宫（如 '乾宫'）——伏神必须按本宫取，遍历八宫会误取他宫 */
  guaGong?: string;
}

export interface AnalysisResult {
  /** 逐爻分析 */
  yaoAnalysis: YaoAnalysis[];
  /** 五神 */
  fiveShen: FiveShen;
  /** 应期候选 */
  timings: TimingCandidate[];
  /** 伏神（用神不上卦时） */
  fuShen: FuShenInfo | null;
  /** 命中的地支格局 */
  patterns: PatternHit[];
  /** 世应之间的间爻位置 */
  jianYao: number[];
}

/**
 * 五神推导：以用神六亲为"我"，按六亲生克链推原神/忌神/仇神/喜神。
 *
 * 定义：原神生用神；忌神克用神；仇神生忌神且克原神；喜神克忌神。
 * 注意：仇神不是"耗用"、喜神不是"泄用"——不借耗泄解释五神。
 *
 * | 用神 | 原神(生用) | 忌神(克用) | 仇神(生忌克原) | 喜神(克忌) |
 * |---|---|---|---|---|
 * | 妻财 | 子孙 | 兄弟 | 父母 | 官鬼 |
 * | 官鬼 | 妻财 | 子孙 | 兄弟 | 父母 |
 * | 父母 | 官鬼 | 妻财 | 子孙 | 兄弟 |
 * | 子孙 | 兄弟 | 父母 | 官鬼 | 妻财 |
 * | 兄弟 | 父母 | 官鬼 | 妻财 | 子孙 |
 */
export function deriveFiveShen(yongShen: string, intent: '吉用' | '凶用' = '吉用'): FiveShen {
  const chain: Record<string, { yuan: string; ji: string; chou: string; xi: string }> = {
    妻财: { yuan: '子孙', ji: '兄弟', chou: '父母', xi: '官鬼' },
    官鬼: { yuan: '妻财', ji: '子孙', chou: '兄弟', xi: '父母' },
    父母: { yuan: '官鬼', ji: '妻财', chou: '子孙', xi: '兄弟' },
    子孙: { yuan: '兄弟', ji: '父母', chou: '官鬼', xi: '妻财' },
    兄弟: { yuan: '父母', ji: '官鬼', chou: '妻财', xi: '子孙' },
  };
  const c = chain[yongShen] || { yuan: '', ji: '', chou: '', xi: '' };
  // 欲成欲散决定利害：吉用时原神喜神吉、忌神仇神凶；凶用反之
  const good = intent === '吉用' ? '吉' : '凶';
  const bad = intent === '吉用' ? '凶' : '吉';
  return {
    yongShen,
    yuanShen: c.yuan,
    jiShen: c.ji,
    chouShen: c.chou,
    xiShen: c.xi,
    intent,
    lihai: {
      [c.yuan]: good,
      [c.xi]: good,
      [c.ji]: bad,
      [c.chou]: bad,
    },
  };
}

/** 主分析函数 */
export function analyzeLiuyao(input: AnalysisInput): AnalysisResult {
  const { yaos, monthZhi, dayZhi, kongWang, yongShenLiuqin } = input;
  const intent = input.intent || '吉用';

  // ── 1. 逐爻旺衰与状态
  const yaoAnalysis: YaoAnalysis[] = yaos.map((y) => {
    const wuxing = DIZHI_WUXING[y.zhi] || '土';
    const monthPower = monthPowerOf(wuxing, monthZhi);
    const deshi = monthPower === '旺' || monthPower === '相';
    const dayRel = dayRelationOf(dayZhi, y.zhi);
    const isVoid = kongWang.includes(y.zhi);

    // 日辰生助/克制
    const daySupports = dayRel === '生' || dayRel === '合' || dayRel === '值';
    const dayPresses = dayRel === '克' || dayRel === '冲';

    // 强弱：旺衰由月令定，强弱看日辰是否有力生助/克制
    // 得令 + 日助 → 强；失令 + 日克 → 弱；其余为中
    let strength: '强' | '弱' | '中' = '中';
    if (deshi && daySupports) strength = '强';
    else if (!deshi && dayPresses) strength = '弱';
    else if (deshi && !dayPresses) strength = '强';
    else if (!deshi && daySupports) strength = '中';

    // 空亡真假：
    //  真亡 = 静空休囚且未得日生助，或用神空化空
    //  暂空 = 静空旺相 / 动空（不论旺衰）/ 衰空得日生助
    let voidState: '无' | '暂空' | '真亡' = '无';
    if (isVoid) {
      const kongHuaKong = y.isDong && y.bianZhi ? kongWang.includes(y.bianZhi) : false;
      if (kongHuaKong) voidState = '真亡';
      else if (y.isDong) voidState = '暂空';
      else if (deshi) voidState = '暂空';
      else if (daySupports) voidState = '暂空';
      else voidState = '真亡';
    }

    // 月破：本地支与月支相冲
    const isMonthBreak = CLASH[monthZhi] === y.zhi;

    // 暗动：日辰冲非空静爻（不论旺衰）
    const isAnDong = !y.isDong && dayRel === '冲' && !isVoid;
    // 日破：日辰冲动爻（冲散），或日冲变爻
    const isDayBreak =
      (y.isDong && dayRel === '冲') ||
      (y.isDong && y.bianZhi ? dayRelationOf(dayZhi, y.bianZhi) === '冲' : false);

    // 入墓
    const graveZhi = graveOf(dayZhi, wuxing);

    // 进退神（仅动爻）
    let jinTui: '化进' | '化退' | '' = '';
    if (y.isDong && y.bianZhi) {
      if (ADVANCE[y.zhi] === y.bianZhi) jinTui = '化进';
      else if (RETREAT[y.zhi] === y.bianZhi) jinTui = '化退';
    }

    // 回头关系（变爻对原动爻）
    let huiTou = '';
    if (y.isDong && y.bianZhi) {
      const bw = DIZHI_WUXING[y.bianZhi] || '土';
      const ow = wuxing;
      if (SHENG[bw] === ow) huiTou = '回生';
      else if (KE[bw] === ow) huiTou = '回克';
      else if (CLASH[y.bianZhi] === y.zhi) huiTou = '回冲';
      else if (HARMONY[y.bianZhi] === y.zhi) huiTou = '回合';
    }

    return {
      position: y.position,
      zhi: y.zhi,
      wuxing,
      monthPower,
      isDeshi: deshi,
      dayRelation: dayRel,
      daySupports,
      dayPresses,
      strength,
      voidState,
      isMonthBreak,
      isAnDong,
      isDayBreak,
      graveZhi,
      jinTui: jinTui || undefined,
      huiTou: huiTou || undefined,
    };
  });

  // ── 2. 五神
  const fiveShen = deriveFiveShen(yongShenLiuqin, intent);

  // ── 3. 地支格局（六冲/六合/三合/三刑/六害/六破）
  const patterns: PatternHit[] = [];
  const zhiAt = (p: number) => yaos.find((y) => y.position === p)?.zhi || '';

  // 六冲：本卦内两爻地支相冲
  for (let i = 0; i < yaos.length; i++) {
    for (let j = i + 1; j < yaos.length; j++) {
      const a = yaos[i], b = yaos[j];
      if (CLASH[a.zhi] === b.zhi) {
        patterns.push({
          name: `${a.position}爻${a.zhi}与${b.position}爻${b.zhi}六冲`,
          nature: '中性',
          note: '冲主快、散、改变；欲聚欲成之事忌冲，欲散欲脱之事可喜冲',
        });
      }
      if (HARMONY[a.zhi] === b.zhi) {
        patterns.push({
          name: `${a.position}爻${a.zhi}与${b.position}爻${b.zhi}六合`,
          nature: '中性',
          note: '合主聚集、协作、迟缓；吉事宜合我，凶事可利合应',
        });
      }
      if (HARM[a.zhi] === b.zhi) {
        patterns.push({
          name: `${a.position}爻${a.zhi}与${b.position}爻${b.zhi}六害`,
          nature: '中性',
          note: '须先有合再被冲破方论害；仅取失约、阻隔、被干涉之象，不另增吉凶权重',
        });
      }
      if (BREAK[a.zhi] === b.zhi) {
        patterns.push({
          name: `${a.position}爻${a.zhi}与${b.position}爻${b.zhi}六破`,
          nature: '中性',
          note: '六破只取失约、阻隔、破坏之象，不另增吉凶权重',
        });
      }
    }
  }

  // 三合局：三支齐全（含动爻变爻参与）
  const allZhi = new Set<string>();
  yaos.forEach((y) => {
    allZhi.add(y.zhi);
    if (y.isDong && y.bianZhi) allZhi.add(y.bianZhi);
  });
  for (const g of THREE_HARMONY) {
    if (g.branches.every((b) => allZhi.has(b))) {
      patterns.push({
        name: `${g.branches.join('')}三合${g.element}局`,
        nature: '中性',
        note: `成局须三支齐全且满足动变条件；化局${g.element}作一条主作用，取多人结伙、聚会之象`,
      });
    }
  }

  // 三刑
  for (const g of PUNISH_GROUPS) {
    if (g.every((b) => allZhi.has(b))) {
      const name = g.join('');
      const label = name === '寅巳申' ? '无恩之刑' : '恃势之刑';
      patterns.push({
        name: `${name}三刑（${label}）`,
        nature: '中性',
        note: '须三支俱全且卦爻俱动，或两发动刑支与日辰凑齐；吉凶随旺衰与有无制救，不凭刑断事实',
      });
    }
  }
  // 自刑
  yaos.forEach((y) => {
    if (SELF_PUNISH.includes(y.zhi) && allZhi.has(y.zhi)) {
      const cnt = yaos.filter((o) => o.zhi === y.zhi).length;
      if (cnt >= 1) {
        patterns.push({
          name: `${y.position}爻${y.zhi}自刑`,
          nature: '中性',
          note: '辰午酉亥自刑不主吉凶，只取自作自受、烦恼之象',
        });
      }
    }
  });

  // 逐爻状态格局
  yaoAnalysis.forEach((a) => {
    if (a.isMonthBreak) {
      patterns.push({
        name: `${a.position}爻${a.zhi}月破`,
        nature: '凶',
        note: '月破为原时背景中的残缺破损；可取忧虑散、财破、事业不振等候选象，须以所问欲成欲散定吉凶',
      });
    }
    if (a.isAnDong) {
      patterns.push({
        name: `${a.position}爻${a.zhi}暗动（日冲静爻）`,
        nature: '中性',
        note: '暗动由外力使令而动，可生克但不独立冲合；衰暗动仍有生克资格，旺衰只表程度',
      });
    }
    if (a.isDayBreak) {
      patterns.push({
        name: `${a.position}爻日破（日冲动/变爻）`,
        nature: '凶',
        note: '日冲动爻为冲散并殃及变爻，动变均失用；日冲变爻亦称日破',
      });
    }
    if (a.voidState === '真亡') {
      patterns.push({
        name: `${a.position}爻${a.zhi}真空`,
        nature: '凶',
        note: '静空休囚未得日生助为真亡，不受动变冲实也不主动作用，所求不成',
      });
    } else if (a.voidState === '暂空') {
      patterns.push({
        name: `${a.position}爻${a.zhi}暂空`,
        nature: '中性',
        note: '暂空出空填实时再应已受之生吉或克凶；有权动变冲暂空为冲实有用',
      });
    }
    if (a.graveZhi) {
      patterns.push({
        name: `${a.position}爻入墓（${a.graveZhi}）`,
        nature: '中性',
        note: '实际入墓者暂停主动与受作用权；动冲墓或流时冲墓为出墓应事条件',
      });
    }
    if (a.jinTui === '化进') {
      patterns.push({
        name: `${a.position}爻化进`,
        nature: '中性',
        note: '吉用、原神宜进；忌仇宜退。旺相化退暂不退、休囚化进暂不进（近事）',
      });
    } else if (a.jinTui === '化退') {
      patterns.push({
        name: `${a.position}爻化退`,
        nature: '中性',
        note: '忌仇宜退；所求是解除凶患时凶用退才有利',
      });
    }
    if (a.huiTou === '回克') {
      patterns.push({
        name: `${a.position}爻动化回头克`,
        nature: '凶',
        note: '回克无有效解救时原动爻力量被克尽；有解救须查转化（贪生忘克）',
      });
    } else if (a.huiTou === '回生') {
      patterns.push({
        name: `${a.position}爻动化回头生`,
        nature: '吉',
        note: '回生表示自身变化带来成就',
      });
    }
  });

  // ── 4. 伏神（用神六亲不上卦时，从本宫纯卦找伏神）
  const fuShen = computeFuShen(yaos, yongShenLiuqin, dayZhi, kongWang, input.guaGong);

  // ── 5. 应期
  const timings = deriveTimings(yaos, yaoAnalysis, monthZhi, dayZhi, yongShenLiuqin);

  // ── 6. 间爻（世应之间的两爻）
  const shiYao = yaos.find((y) => y.isShi);
  const yingYao = yaos.find((y) => y.isYing);
  let jianYao: number[] = [];
  if (shiYao && yingYao) {
    const lo = Math.min(shiYao.position, yingYao.position);
    const hi = Math.max(shiYao.position, yingYao.position);
    jianYao = yaos.map((y) => y.position).filter((p) => p > lo && p < hi);
  }

  return { yaoAnalysis, fiveShen, timings, fuShen, patterns, jianYao };
}

// ─── 伏神 ────────────────────────────────────────────

/**
 * 伏神：用神六亲不上卦时，从本宫纯卦的对应爻位取伏神。
 * 简化实现：以"本宫卦"的六爻为伏神来源（京房体系下每宫纯卦六爻俱全六亲）。
 * 飞爻为覆盖伏神爻位的本卦之爻。
 */
function computeFuShen(
  yaos: AnalysisInput['yaos'],
  yongShenLiuqin: string,
  dayZhi: string,
  kongWang: string[],
  guaGong?: string,
): FuShenInfo | null {
  // 本卦已有该六亲 → 无需伏神
  const present = yaos.find((y) => y.liuqin === yongShenLiuqin);
  if (present) return null;

  // 京房八宫纯卦六爻地支（伏神来源，按爻位 1-6 自下而上）
  const PALACE_YAO_ZHI: Record<string, string[]> = {
    乾宫: ['子', '寅', '辰', '午', '申', '戌'],
    坤宫: ['未', '巳', '卯', '丑', '亥', '酉'],
    震宫: ['子', '寅', '辰', '午', '申', '戌'],
    巽宫: ['丑', '亥', '酉', '未', '巳', '卯'],
    坎宫: ['寅', '辰', '午', '申', '戌', '子'],
    离宫: ['卯', '丑', '亥', '酉', '未', '巳'],
    艮宫: ['辰', '午', '申', '戌', '子', '寅'],
    兑宫: ['巳', '卯', '丑', '亥', '酉', '未'],
  };
  const gongWuxingMap: Record<string, string> = {
    乾宫: '金', 兑宫: '金', 震宫: '木', 巽宫: '木',
    坎宫: '水', 离宫: '火', 艮宫: '土', 坤宫: '土',
  };

  // 本宫优先：伏神取自本宫纯卦对应爻位（京房飞伏），本宫无此六亲时才遍历他宫兜底。
  const gongOrder = Object.keys(PALACE_YAO_ZHI).sort((a, b) => {
    if (a === guaGong) return -1;
    if (b === guaGong) return 1;
    return 0;
  });

  for (const gong of gongOrder) {
    const zhis = PALACE_YAO_ZHI[gong];
    const gw = gongWuxingMap[gong];
    for (let i = 0; i < zhis.length; i++) {
      const zw = DIZHI_WUXING[zhis[i]];
      const rel = liuqinOf(gw, zw);
      if (rel === yongShenLiuqin) {
        const pos = i + 1;
        const fei = yaos.find((y) => y.position === pos);
        const feiZhi = fei?.zhi || '';
        // 开闭伏判定（简化）：
        //  闭伏 = 日克伏 / 日冲伏带克 / 飞克伏
        //  开伏 = 日生伏 / 日值伏 / 日冲伏不带克 / 飞空 / 飞生伏
        const fuWx = zw;
        const dayWx = DIZHI_WUXING[dayZhi] || '土';
        const dayKeFu = KE[dayWx] === fuWx;
        const dayShengFu = SHENG[dayWx] === fuWx;
        const dayChongFu = CLASH[dayZhi] === zhis[i];
        const dayZhiFu = dayZhi === zhis[i];
        const feiKeFu = feiZhi ? KE[DIZHI_WUXING[feiZhi] || '土'] === fuWx : false;
        const feiShengFu = feiZhi ? SHENG[DIZHI_WUXING[feiZhi] || '土'] === fuWx : false;
        const feiKong = feiZhi ? kongWang.includes(feiZhi) : false;

        let state: '开伏' | '闭伏' = '闭伏';
        let reason = '';
        if (dayKeFu) {
          reason = '日克伏，闭伏';
        } else if (feiKeFu && !feiKong) {
          reason = `飞爻${feiZhi}克伏，闭伏（须先解除飞之覆盖）`;
        } else if (dayShengFu) {
          state = '开伏'; reason = '日生伏，开伏';
        } else if (dayZhiFu) {
          state = '开伏'; reason = '日值伏，开伏';
        } else if (dayChongFu) {
          state = '开伏'; reason = '日冲伏不带克，可出';
        } else if (feiKong) {
          state = '开伏'; reason = '飞爻空亡，伏神可自出';
        } else if (feiShengFu) {
          state = '开伏'; reason = '飞生伏，开伏';
        } else {
          reason = '无明确开伏条件，暂按闭伏';
        }
        return {
          liuqin: yongShenLiuqin,
          position: pos,
          zhi: zhis[i],
          feiPosition: pos,
          feiZhi,
          state,
          reason,
        };
      }
    }
  }
  return null;
}

/** 由宫五行与爻支五行推六亲 */
function liuqinOf(gongWuxing: string, zhiWuxing: string): string {
  if (gongWuxing === zhiWuxing) return '兄弟';
  if (SHENG[gongWuxing] === zhiWuxing) return '子孙';
  if (KE[gongWuxing] === zhiWuxing) return '妻财';
  if (SHENG[zhiWuxing] === gongWuxing) return '父母';
  if (KE[zhiWuxing] === gongWuxing) return '官鬼';
  return '兄弟';
}

// ─── 应期 ────────────────────────────────────────────

/** 应期推导：按条件应期表输出候选（只给能够确定的范围，不报公历日期） */
function deriveTimings(
  yaos: AnalysisInput['yaos'],
  analysis: YaoAnalysis[],
  monthZhi: string,
  dayZhi: string,
  yongShenLiuqin: string,
): TimingCandidate[] {
  const out: TimingCandidate[] = [];
  const yongYao = yaos.find((y) => y.liuqin === yongShenLiuqin);
  if (!yongYao) {
    // 用神不上卦 → 伏神出伏期
    return [{ mechanism: 'hidden_release', triggerBranch: '', meaning: '用神伏藏，待冲飞或出伏时', speed: '慢' }];
  }
  const a = analysis.find((x) => x.position === yongYao.position);
  if (!a) return out;

  const zhi = a.zhi;
  // 用静 → 逢值或冲动
  if (!yongYao.isDong) {
    out.push({ mechanism: 'static_value', triggerBranch: zhi, meaning: '用神静，逢值日应', speed: '慢' });
    out.push({ mechanism: 'static_clash', triggerBranch: CLASH[zhi], meaning: '用神静，逢冲日应（流冲为应期标志）', speed: '快' });
  } else {
    // 用动 → 逢合、逢值，或变支值
    out.push({ mechanism: 'moving_value', triggerBranch: zhi, meaning: '用神动，逢值日应', speed: '快' });
    out.push({ mechanism: 'moving_harmony', triggerBranch: HARMONY[zhi], meaning: '用神动，逢合日应', speed: '慢' });
    if (yongYao.bianZhi) {
      out.push({ mechanism: 'changed_value', triggerBranch: yongYao.bianZhi, meaning: '变爻逢值日应', speed: '快' });
    }
  }
  // 假空 → 出空填实
  if (a.voidState === '暂空') {
    out.push({ mechanism: 'void_fill', triggerBranch: zhi, meaning: '暂空，出空填实日应', speed: '慢' });
    out.push({ mechanism: 'void_clash', triggerBranch: CLASH[zhi], meaning: '暂空，逢冲日应（限有权动变冲实）', speed: '快' });
  }
  // 月破未被日散脱 → 逢值或合
  if (a.isMonthBreak) {
    out.push({ mechanism: 'month_break_value', triggerBranch: zhi, meaning: '月破逢值日应（原局仍可成者）', speed: '慢' });
    out.push({ mechanism: 'month_break_harmony', triggerBranch: HARMONY[zhi], meaning: '月破逢合日应', speed: '慢' });
    out.push({ mechanism: 'month_break_exit', triggerBranch: CLASH[monthZhi], meaning: '出当前月令后应', speed: '慢' });
  }
  // 入墓 → 冲墓
  if (a.graveZhi) {
    out.push({ mechanism: 'grave_clash', triggerBranch: CLASH[a.graveZhi], meaning: '入墓，冲墓日出墓应事', speed: '慢' });
  }
  // 化进/化退
  if (a.jinTui === '化进') {
    out.push({ mechanism: 'advance', triggerBranch: zhi, meaning: '化进，本变支逢值或合时应', speed: '快' });
  } else if (a.jinTui === '化退') {
    out.push({ mechanism: 'retreat', triggerBranch: zhi, meaning: '化退，本支或变支逢值时应', speed: '快' });
  }
  // 暗动
  if (a.isAnDong) {
    out.push({ mechanism: 'andong', triggerBranch: HARMONY[zhi], meaning: '暗动，合暗动爻或合日辰时应', speed: '快' });
  }

  // 去重
  const seen = new Set<string>();
  return out.filter((t) => {
    const k = t.mechanism + t.triggerBranch;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
