/**
 * 公共解盘输出清洗（R18 起）
 *
 * 抽离原 lib/qimen/remedy 与 app/api/qimen-interpret 中的 sanitizeQimenOutput，
 * 抽象掉"奇门专属"的味道，变为所有起局模块共用的纯文本清洗工具。
 *
 * 强制规则（与原奇门口径一致，由奇门延续而来）：
 * 1. 剔除正文最前部的元话语行（"我将……""以下是为您……""好的，……"等），最多连续 6 行
 * 2. 全文剔除 Markdown 符号：行首 # 标题、行内 * 与 `、行首引用符/无序列表符
 * 3. 压缩多余空行（连续 3+ 个换行 → 2 个）
 *
 * 前端是 whitespace-pre-wrap 纯文本渲染，Markdown 符号会原样显示成乱码。
 * Prompt 铁律（提示词公因子 lib/ai/prompt-constitution）已禁用 Markdown 与开场白，
 * 此处做代码级兜底清洗。
 */

const META_LINE_RE =
  /(我将|我会|以下是|为您解读|为您剖析|严格遵循|遵循.{0,12}(体系|方法)|作为一(位|名)|好的，|您好，|很高兴)/;

const MAX_META_LINES = 6;

export interface SanitizeOptions {
  /** 是否要求首行必须以【】段落标题开头（默认 false，向后兼容） */
  requireBracketHeader?: boolean;
}

/**
 * 公共纯文本清洗：移除元话语行 + Markdown 符号 + 压缩空行。
 * @param raw 原始 LLM 输出
 * @returns 清洗后文本
 */
export function sanitizeDivinationOutput(raw: string, options: SanitizeOptions = {}): string {
  if (!raw) return '';
  const lines = raw.replace(/\r\n/g, '\n').split('\n');

  // 仅清理正文最前部的元话语行（短行且非【】段落标题），逐行剔除直到遇到正文或达到上限
  let stripped = 0;
  while (lines.length > 0 && stripped < MAX_META_LINES) {
    const first = lines.findIndex((l) => l.trim() !== '');
    if (first === -1) {
      lines.length = 0;
      break;
    }
    const line = lines[first].trim();
    // 跳过空行不计入
    if (line.length === 0) {
      lines.splice(first, 1);
      continue;
    }
    const looksLikeHeader = line.startsWith('【') && line.includes('】');
    const isMeta = line.length < 80 && !looksLikeHeader && META_LINE_RE.test(line);
    if (isMeta) {
      lines.splice(first, 1);
      stripped += 1;
    } else {
      break;
    }
  }

  // 兜底：若 requireBracketHeader=true 且清洗后首行非【】开头，再尝试剥一行
  if (options.requireBracketHeader && lines.length > 0) {
    const firstNonEmpty = lines.findIndex((l) => l.trim() !== '');
    if (firstNonEmpty !== -1) {
      const first = lines[firstNonEmpty].trim();
      if (!first.startsWith('【') && first.length < 80) {
        lines.splice(firstNonEmpty, 1);
      }
    }
  }

  return lines
    .map((l) => {
      let s = l.replace(/^\s*#{1,6}\s*/, ''); // 行首标题井号
      s = s.replace(/\*/g, ''); // 粗体/斜体星号
      s = s.replace(/`/g, ''); // 行内代码反引号
      s = s.replace(/^\s*>\s?/, ''); // 行首引用符
      s = s.replace(/^\s*[-•]\s+/, '· '); // 无序列表符 → 间隔点
      return s;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
