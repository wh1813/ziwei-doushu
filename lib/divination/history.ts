/**
 * 起局模块公共 best-effort 落库 + 回填链路（R18 起）
 *
 * 抽象掉"qimen_records / sixyao_records / ..."的差异，所有起局模块共用同一套
 * save*Record / update*RecordInterpret 流程：
 *
 * 1) 落库（save*Record）
 *    - INSERT 完整 chart_payload JSON + 关键起局要素到对应表
 *    - 成功返回新记录 id（UUID）
 *    - D1 不可用 / 记录表未建 / 字段不匹配 → 静默返回 null，绝不抛错影响主流程
 *
 * 2) 回填（update*RecordInterpret）
 *    - UPDATE interpret_text + interpreted_at WHERE id = ?
 *    - 成功返回 true
 *    - recordId 非法 / D1 不可用 / interpret_text 列不存在（迁移未应用） → 静默返回 false
 *
 * 各模块的 save*Record 实现差异只在"表名 + INSERT 列"上，由调用方传入 RecordSchema：
 *   saveDivinationRecord({ table: 'sixyao_records', columns: [...], values: [...] })
 *
 * 既有约定：表名 snake_case + _records 后缀；id 为 TEXT PK；interpret_text 50k 上限。
 */

import { getQueryLogDatabase } from '@/lib/logging/query-log';
import {
  INTERPRET_TEXT_MAX,
  UUID_RE,
  type DivinationModule,
} from './types';

export interface RecordSchema {
  table: string;
  columns: string[];
  values: unknown[];
}

/** UUID 校验，非法直接返回 false */
function isValidUuid(s: string): boolean {
  return UUID_RE.test(s);
}

/** 通用落库：按传入的 schema 拼 INSERT SQL；成功返回新 id，失败返回 null */
export async function saveDivinationRecord(schema: RecordSchema): Promise<string | null> {
  const db = getQueryLogDatabase();
  if (!db) return null;
  if (!schema.table || !Array.isArray(schema.columns) || !Array.isArray(schema.values)) return null;
  if (schema.columns.length !== schema.values.length) return null;
  // 表名/列名白名单：仅允许字母数字下划线（防止 schema 拼接注入）
  const SAFE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  if (!SAFE.test(schema.table)) return null;
  for (const col of schema.columns) {
    if (!SAFE.test(col)) return null;
  }
  try {
    const recordId = crypto.randomUUID();
    const placeholders = schema.columns.map(() => '?').join(', ');
    const sql = `INSERT INTO ${schema.table} (id, ${schema.columns.join(', ')}) VALUES (?, ${placeholders})`;
    await db
      .prepare(sql)
      .bind(recordId, ...schema.values)
      .run();
    return recordId;
  } catch (error) {
    console.error(
      `[divination] save ${schema.table} failed`,
      error instanceof Error ? error.message : 'unknown',
    );
    return null;
  }
}

/** 通用回填：UPDATE interpret_text + interpreted_at；成功返回 true，失败返回 false */
export async function updateDivinationRecordInterpret(
  module: DivinationModule,
  recordId: string,
  interpretText: string,
): Promise<boolean> {
  if (!isValidUuid(recordId)) return false;
  const db = getQueryLogDatabase();
  if (!db) return false;
  // 构造表名：qimen/sixyao/... → 各自 _records 表
  const table = `${module}_records`;
  const SAFE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  if (!SAFE.test(table)) return false;
  try {
    const text = (interpretText || '').slice(0, INTERPRET_TEXT_MAX);
    await db
      .prepare(`UPDATE ${table} SET interpret_text = ?, interpreted_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(text, recordId)
      .run();
    return true;
  } catch (error) {
    // 最常见：迁移 0005 未应用（no such column: interpret_text）→ 静默失败
    console.error(
      `[divination] update ${table} interpret failed`,
      error instanceof Error ? error.message : 'unknown',
    );
    return false;
  }
}

/**
 * 兼容旧调用：qimen 既有 saveQimenRecord 行为。
 * 之所以保留它：避免一次性破坏既有 qimen_records 链路；R18-1 仅在并行新增 divination/*，
 * 老 qimen/history.ts 的实现保留至 R18-2 之后再统一迁移。
 * 详见 R18 规划 §4.2。
 */
