// lib/fortune/extract.ts
// 跨模块起局 JSON 聚合（运势中心 V1.0 用）
//
// 设计要点：
// - 复用 4 个术数模块的 extractChartSummary（确定性引擎产出）
// - 模块白名单：qimen | liuyao | daliuren | xiaoliuren（手相不接：vision 路径无结构化盘面）
// - 每模块 summary 截断至 MAX_KEY_CHARS（防御 token 溢出）
// - 最少结构校验：qimen 含 pan/ju; liuyao 含 benGua; daliuren 含 siKe; xiaoliuren 含 steps
// - 失败抛 {ok:false, error} 由 route 转 400
//
// 与 lib/divination/history.ts 的 best-effort 模式区分：本模块是请求必填校验，
// 校验失败必须 400 拒绝（不能让 LLM 杜撰盘面）。

import { extractChartSummary as qimenSummary, type QimenFullResult } from '@/lib/qimen/engine';
import { extractChartSummary as liuyaoSummary, type LiuyaoFullResult } from '@/lib/liuyao/engine';
import { extractChartSummary as daliurenSummary, type DaliurenFullResult } from '@/lib/daliuren/engine';
import { extractChartSummary as xiaoliurenSummary, type XiaoliurenResult } from '@/lib/xiaoliuren/engine';

export type FortuneModule = 'qimen' | 'liuyao' | 'daliuren' | 'xiaoliuren';

export const FORTUNE_MODULES: readonly FortuneModule[] = ['qimen', 'liuyao', 'daliuren', 'xiaoliuren'] as const;

export interface FortuneChartInput {
  module: FortuneModule;
  json: unknown; // 来自 qimen/liuyao/daliuren/xiaoliuren chart API 的完整响应
}

export interface FortuneExtractedChart {
  module: FortuneModule;
  summary: Record<string, unknown>;
  // 摘要可读化文本（用于塞进 userPrompt），截断到 MAX_KEY_CHARS
  summaryText: string;
}

export interface FortuneContext {
  charts: FortuneExtractedChart[];
}

// 防御 token 溢出：每模块 summary JSON 转字符串后截断
const MAX_KEY_CHARS = 600;
// 防御 body 过大：单 chart JSON 转字符串后截断
const MAX_RAW_CHARS = 4000;

interface ValidateResult { ok: true; }
interface ValidateFail { ok: false; error: string; }
type ValidateOutcome = ValidateResult | ValidateFail;

function validateModuleJson(module: FortuneModule, raw: unknown): ValidateOutcome {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, error: `${module} json 必须是对象` };
  }
  const obj = raw as Record<string, unknown>;
  switch (module) {
    case 'qimen': {
      // QimenFullResult 在 chart 字段下含 palaces + juNumber + dunType
      const chart = (obj.chart && typeof obj.chart === 'object') ? obj.chart as Record<string, unknown> : null;
      if (!chart) return { ok: false, error: 'qimen json 缺 chart 字段' };
      if (typeof chart.juNumber !== 'number' && typeof chart.ju_number !== 'number') {
        return { ok: false, error: 'qimen chart 缺 juNumber 字段' };
      }
      if (!Array.isArray(chart.palaces) && !Array.isArray(chart.palaceList)) {
        return { ok: false, error: 'qimen chart 缺 palaces 数组' };
      }
      return { ok: true };
    }
    case 'liuyao': {
      // LiuyaoFullResult 在 chart 字段下含 benGua
      const chart = (obj.chart && typeof obj.chart === 'object') ? obj.chart as Record<string, unknown> : null;
      if (!chart) return { ok: false, error: 'liuyao json 缺 chart 字段' };
      if (typeof chart.benGua !== 'string') {
        return { ok: false, error: 'liuyao chart 缺 benGua 字段' };
      }
      return { ok: true };
    }
    case 'daliuren': {
      // DaliurenFullResult 在 siKe 字段下含四课
      if (typeof obj.siKe !== 'object' || obj.siKe === null) {
        return { ok: false, error: 'daliuren json 缺 siKe 字段' };
      }
      return { ok: true };
    }
    case 'xiaoliuren': {
      // XiaoliurenResult 在 steps 字段下含三步
      if (typeof obj.steps !== 'object' || obj.steps === null) {
        return { ok: false, error: 'xiaoliuren json 缺 steps 字段' };
      }
      return { ok: true };
    }
  }
}

function safeStringify(v: unknown, max: number): string {
  try {
    const s = JSON.stringify(v, (_k, val) => {
      // 防御循环引用与函数
      if (typeof val === 'function') return undefined;
      if (typeof val === 'string' && val.length > 200) return val.slice(0, 200) + '…';
      return val;
    });
    if (s === undefined) return '{}';
    if (s.length <= max) return s;
    return s.slice(0, max) + '…(已截断)';
  } catch {
    return '{}';
  }
}

/**
 * 把任意 chart JSON 还原成各模块引擎所需的 result 形状。
 * Qimen/Liuyao/Daliuren 路由返回的 JSON 都是 { recordId?, chart, ganzhi?, ... } 套壳
 * 一些外层字段，需要把 chart 单独抽出送入 extractChartSummary。
 */
function extractInnerResult(module: FortuneModule, raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  switch (module) {
    case 'qimen':
    case 'liuyao':
    case 'daliuren':
      // 这三个的 chart API 返回 { recordId?, chart, ganzhi?, ... }
      // extractChartSummary 接收 LiuyaoFullResult/DaliurenFullResult/QimenFullResult
      // 它们把 chart/ganzhi/siKe 当成顶层字段，所以把 obj 当 result 直接传。
      return obj;
    case 'xiaoliuren':
      // xiaoliuren chart API 也返回 { recordId?, lunar, steps, result, ... } 直接当 result 传
      return obj;
  }
}

export function validateFortuneInput(input: { charts?: FortuneChartInput[] }): ValidateOutcome {
  if (!Array.isArray(input.charts) || input.charts.length === 0) {
    return { ok: false, error: 'charts 数组不能为空，至少需要 1 个起局 JSON' };
  }
  if (input.charts.length > 4) {
    return { ok: false, error: '最多接收 4 个模块的起局 JSON' };
  }
  const seen = new Set<FortuneModule>();
  for (const c of input.charts) {
    if (!c || typeof c !== 'object') {
      return { ok: false, error: 'charts 元素必须为 {module, json}' };
    }
    if (!FORTUNE_MODULES.includes(c.module)) {
      return { ok: false, error: `不支持的 module: ${c.module}（仅 qimen/liuyao/daliuren/xiaoliuren）` };
    }
    if (seen.has(c.module)) {
      return { ok: false, error: `module ${c.module} 重复，每个模块只允许 1 次` };
    }
    seen.add(c.module);
    const v = validateModuleJson(c.module, c.json);
    if (!v.ok) return v;
  }
  return { ok: true };
}

/**
 * 主入口：把用户提交的 charts 数组 → 标准化为每个模块的 summary
 * 返回失败时由调用方转 400
 */
export function extractFortuneContext(charts: FortuneChartInput[]): FortuneContext {
  const out: FortuneExtractedChart[] = [];
  for (const c of charts) {
    const inner = extractInnerResult(c.module, c.json) as any;
    let summary: Record<string, unknown>;
    try {
      switch (c.module) {
        case 'qimen':     summary = qimenSummary(inner as QimenFullResult); break;
        case 'liuyao':    summary = liuyaoSummary(inner as LiuyaoFullResult); break;
        case 'daliuren':  summary = daliurenSummary(inner as DaliurenFullResult); break;
        case 'xiaoliuren':summary = xiaoliurenSummary(inner as XiaoliurenResult); break;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`${c.module} summary 抽取失败: ${msg}`);
    }
    out.push({
      module: c.module,
      summary,
      summaryText: safeStringify(summary, MAX_KEY_CHARS),
    });
  }
  return { charts: out };
}
