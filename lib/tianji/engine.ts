import { astro } from 'iztro';

/**
 * 天纪深度解读 —— 确定性引擎层
 *
 * 职责边界（防幻觉核心）：
 *  1. 参数校验：要素缺失严禁强排，返回 NEED_CLARIFICATION 语义的提示
 *  2. 确定性排盘：iztro 纯算法排盘，星曜落宫/庙旺利陷/四化全由代码计算
 *  3. 天纪格局匹配：倪海夏《天纪》体系高频格局的规则判定
 *  4. Prompt 组装：LLM 只允许基于已算好的盘骨架做论述，严禁改盘
 *
 * 本模块不发起任何网络请求，便于单测与复用。
 */

// ─── 输入与校验 ───────────────────────────────────────────

export interface TianjiInput {
  solarDate: string; // YYYY-MM-DD 阳历
  timeIndex: number; // 0:早子 1:丑 ... 11:亥 12:晚子
  gender: '男' | '女';
  question?: string;
}

/** 校验输入要素，缺少信息严禁强排。返回错误文案或 null。 */
export function validateTianjiInput(p: {
  solarDate?: unknown;
  timeIndex?: unknown;
  gender?: unknown;
}): string | null {
  if (typeof p.solarDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.solarDate)) {
    return '请提供准确的阳历出生日期（格式：YYYY-MM-DD）。';
  }
  const probe = new Date(`${p.solarDate}T00:00:00Z`);
  if (Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== p.solarDate) {
    return '出生日期无效，请核对年月日。';
  }
  const t = p.timeIndex;
  if (typeof t !== 'number' || !Number.isInteger(t) || t < 0 || t > 12) {
    return '请指定准确的出生时辰（0~12，其中 0 为早子时，12 为晚子时）。';
  }
  if (p.gender !== '男' && p.gender !== '女') {
    return '请明确性别（“男”或“女”），紫微斗数起大限行运阴阳男女有别。';
  }
  return null;
}

// ─── 排盘与骨架提炼 ───────────────────────────────────────

interface StarLike {
  name: string;
  brightness?: string;
  mutagen?: string;
}

interface PalaceLike {
  name?: string;
  earthlyBranch: string;
  heavenlyStem?: string;
  majorStars: StarLike[];
  minorStars?: StarLike[];
}

function safePalace(astrolabe: any, name: string): PalaceLike | null {
  try {
    const p = astrolabe?.palace?.(name);
    return p ?? null;
  } catch {
    return null;
  }
}

function fmtStars(stars: StarLike[] | undefined): string[] {
  return (stars ?? []).map((s) => {
    const bright = s.brightness ? `(${s.brightness})` : '';
    const mut = s.mutagen ? `[化${s.mutagen}]` : '';
    return `${s.name}${bright}${mut}`;
  });
}

/** 服务端确定性排盘，失败抛错。 */
export function castAstrolabe(input: TianjiInput): any {
  return astro.bySolar(input.solarDate, input.timeIndex, input.gender, true, 'zh-CN');
}

/** 从庞大盘对象提炼 LLM 所需的精简骨架：省 Token、减干扰。 */
export function extractNatalSummary(astrolabe: any) {
  const soul = safePalace(astrolabe, '命宫');
  const career = safePalace(astrolabe, '官禄');
  const wealth = safePalace(astrolabe, '财帛');
  const travel = safePalace(astrolabe, '迁移');

  return {
    basic: {
      solarDate: astrolabe?.solarDate,
      lunarDate: astrolabe?.lunarDate,
      chineseDate: astrolabe?.chineseDate, // 四柱干支
      element5: astrolabe?.fiveElementsClass, // 五行局
      gender: astrolabe?.gender,
    },
    corePalaces: {
      命宫: soul
        ? { earthlyBranch: soul.earthlyBranch, majorStars: fmtStars(soul.majorStars), minorStars: (soul.minorStars ?? []).map((s) => s.name) }
        : null,
      迁移宫: travel ? { earthlyBranch: travel.earthlyBranch, majorStars: fmtStars(travel.majorStars) } : null,
      官禄宫: career ? { earthlyBranch: career.earthlyBranch, majorStars: fmtStars(career.majorStars) } : null,
      财帛宫: wealth ? { earthlyBranch: wealth.earthlyBranch, majorStars: fmtStars(wealth.majorStars) } : null,
    },
  };
}

// ─── 倪海夏《天纪》体系高频格局匹配（规则判定） ─────────────

export function checkTianjiPatterns(astrolabe: any): string[] {
  const patterns: string[] = [];
  const soul = safePalace(astrolabe, '命宫');
  const soulMajorNames = (soul?.majorStars ?? []).map((s) => s.name);

  // 1. 紫府坐命
  if (soulMajorNames.includes('紫微') && soulMajorNames.includes('天府')) {
    patterns.push('【紫府同宫格】：天纪云“紫府同宫，终身福厚”，主器度沉雄、名利双收，但行运忌陀罗火铃冲破。');
  }

  // 2. 杀破狼格局
  if (soulMajorNames.some((name) => ['七杀', '破军', '贪狼'].includes(name))) {
    patterns.push('【杀破狼格】：主一生起伏大，主动求变。天纪强调“杀破狼见禄马则主封疆威权，见羊陀火铃需防行事躁进”。');
  }

  // 3. 日照雷门（太阳在卯）
  if (soulMajorNames.includes('太阳') && soul?.earthlyBranch === '卯') {
    patterns.push('【日照雷门格】：天纪体系视为大吉格局，旭日初升，主早年得志、名扬四海，最宜官贵或学术扬名。');
  }

  // 4. 巨日同宫（太阳巨门在寅）
  if (soulMajorNames.includes('太阳') && soulMajorNames.includes('巨门') && soul?.earthlyBranch === '寅') {
    patterns.push('【巨日同宫格】：天纪讲“食君之禄，宜求名不求利”，多利于司法、公职、外交、文化教育传播。');
  }

  // 5. 天府朝垣
  const travel = safePalace(astrolabe, '迁移');
  if ((travel?.majorStars ?? []).some((s) => s.name === '天府')) {
    patterns.push('【天府朝垣格】：出门在外易得贵人扶持，利于离乡发展。');
  }

  return patterns;
}

// ─── 防幻觉 Prompt 组装 ───────────────────────────────────

export interface TianjiPromptBundle {
  systemPrompt: string;
  userPrompt: string;
  chartContext: string; // 供日志记录的盘骨架摘要
}

export function buildTianjiPrompt(input: TianjiInput, summary: any, patterns: string[]): TianjiPromptBundle {
  const systemPrompt = `
【身份定义】
你是一位严谨精通倪海夏先生《天纪》体系的紫微斗数推演分析助手。

【系统刚性约束】
1. 严禁篡改命盘：所有星曜落宫、庙旺利陷、干支化曜均已由确定性排盘引擎生成，你只能基于下方【确定性命盘骨架】进行推导，严禁自行编造星曜位置。
2. 秉持《天纪》论命核心法度：
   - 区分“天纪（命盘先天）”“地纪（地理阳宅配置）”与“人纪（人事修养）”。命盘仅定先天格局趋势，事在人为，重在趋吉避凶。
   - 重点看“命、迁、官、财”三方四正，先定主性格与格调，再断事业求名还是求利。
   - 严格遵循《天纪》断语，不杂糅飞星四化伪派学说。
3. 安全红线：
   - 严禁断具体生死寿元，遇凶煞疾厄仅作健康保养提醒，不可做病理诊断。
   - 严禁给出绝对化宿命论断语，语气正向、给出路。

【确定性命盘骨架（由 iztro 排盘引擎计算导出）】
${JSON.stringify(summary, null, 2)}

【命中天纪古籍与格局】
${patterns.length > 0 ? patterns.join('\n') : '暂无特殊大格，按三方四正星情常合格推论。'}
`.trim();

  const userPrompt = `
求测意图：${input.question?.trim() || '请全面剖析此命盘的先天格局、事业官运特征及人生发展核心建议。'}

请按以下顺序结构化输出：
1. 【定盘明局】：说明五行局、命宫主星庙旺及三方四正星曜结构。
2. 【格局研判】：结合命中之《天纪》格局与星曜性质，阐述其核心优势与行事短板。
3. 【发展进路】：依倪师《天纪》教导，指明其适合“求官（走政学体系）”还是“求财（商海自主）”。
4. 【趋吉指引】：基于“人纪修持”，给出 2~3 条实际生活中的修心与避坑建议。
`.trim();

  // 供 provider 层作为“程序已算好的命盘上下文”注入（provider 会自带“不得自行改盘”约束）
  const chartContext = [
    JSON.stringify(summary, null, 2),
    patterns.length > 0 ? `【命中天纪格局】\n${patterns.join('\n')}` : '【命中天纪格局】暂无特殊大格，按三方四正星情常合格推论。',
  ].join('\n\n');

  return { systemPrompt, userPrompt, chartContext };
}
