/**
 * 起局模块公共类型（R18 起）
 *
 * 设计目标：6 个起局模块（六爻/大六壬/小六壬/紫微/奇门/梅花等）共享同一套落库 + 解盘回填链路。
 * 每个模块的"起局算法"独立（lib/qimen、lib/ziwei、各自实现），但"记录入 D1 + 解释回填"统一。
 *
 * 不变式：
 * - recordId 一律用 crypto.randomUUID() 生成（与 qimen_records.id 类型一致：TEXT UUID）
 * - chart_payload 一律是 JSON.stringify 后的完整盘面（LLM 解读的唯一输入）
 * - interpret_text 上限 50k 字符（与 qimen_records.interpret_text 对齐）
 * - 全部 best-effort：D1 不可用 / 记录不存在 / 迁移未应用时静默失败，绝不影响主流程
 */

export type DivinationModule =
  | 'qimen'      // 奇门遁甲（既有）
  | 'ziwei'      // 紫微斗数（既有）
  | 'sixyao'     // 六爻（周易）
  | 'daliuren'   // 大六壬
  | 'xiaoliuren' // 小六壬
  | 'meihua'     // 梅花易数
  | 'relationship'; // 关系合盘（双人/多人合局）

/** 排盘接口统一形态（具体模块自行实现） */
export interface DivinationChartInput {
  solarDate: string;
  timeIndex: number;
  questionType: string;
  questionGoal?: string;
  birthDate?: string;
  birthTimeIndex?: number;
  // 模块专属扩展
  [k: string]: unknown;
}

export interface DivinationChartResult {
  module: DivinationModule;
  input: DivinationChartInput;
  /** 完整盘面 JSON 字符串（落库 + LLM 上下文骨架） */
  chartPayloadJson: string;
  /** 落库后返回的记录 id（best-effort；D1 不可用时为 null） */
  recordId: string | null;
  /** 起局耗时（ms） */
  durationMs: number;
}

/** 解盘接口入参 */
export interface DivinationInterpretInput {
  module: DivinationModule;
  chart: DivinationChartInput;
  recordId?: string | null;
  sessionId?: string;
  questionGoal?: string;
}

/** UUID 校验（与 qimen history 同一规则） */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const INTERPRET_TEXT_MAX = 50000;
export const CHART_PAYLOAD_MAX = 16000;
