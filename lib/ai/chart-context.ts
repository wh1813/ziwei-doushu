import type { ZiweiChart } from '@/lib/ziwei/types';

const BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];

function safeText(value: unknown, maxLength = 40): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

export function isChartLike(value: unknown): value is ZiweiChart {
  if (!value || typeof value !== 'object') return false;
  const chart = value as Partial<ZiweiChart>;
  return Boolean(chart.birthInfo && chart.lunarInfo && Array.isArray(chart.palaces) && chart.palaces.length === 12);
}

export function buildChartContext(chart: ZiweiChart): string {
  const birth = chart.birthInfo;
  const lunar = chart.lunarInfo;
  const currentDaXian = chart.daXians?.[chart.currentDaXianIndex];
  const lines = [
    '【基础资料】',
    `性别：${birth.gender === 'male' ? '男' : '女'}`,
    `公历：${birth.year}-${birth.month}-${birth.day}，${BRANCHES[birth.hour] || '未知'}时`,
    `农历：${lunar.lunarYear}年${lunar.isLeapMonth ? '闰' : ''}${Math.abs(lunar.lunarMonth)}月${lunar.lunarDay}日`,
    `年干支：${STEMS[lunar.yearStem] || '未知'}${BRANCHES[lunar.yearBranch] || '未知'}`,
    `五行局：${safeText(chart.wuxingJuName)}`,
    `当前年龄：${chart.currentAge}`,
  ];

  if (currentDaXian) {
    lines.push(`当前大限：${currentDaXian.startAge}-${currentDaXian.endAge}岁，${safeText(currentDaXian.palaceName)}宫`);
    if (currentDaXian.siHua) {
      lines.push(`大限四化：${safeText(currentDaXian.siHua.lu)}化禄、${safeText(currentDaXian.siHua.quan)}化权、${safeText(currentDaXian.siHua.ke)}化科、${safeText(currentDaXian.siHua.ji)}化忌`);
    }
  }

  lines.push('', '【十二宫】');
  for (const palace of chart.palaces) {
    const labels: string[] = [];
    if (palace.isMingGong) labels.push('命宫');
    if (palace.isShenGong) labels.push('身宫');
    if (palace.isCurrentDaXian) labels.push('当前大限');
    const stars = palace.stars.slice(0, 20).map(star => `${safeText(star.name)}${star.siHua ? `化${star.siHua}` : ''}`);
    const selfSihua = palace.selfSihua?.slice(0, 8).map(item => `${safeText(item.starName)}自化${item.siHua}`) ?? [];
    lines.push(
      `${safeText(palace.name)}宫（${STEMS[palace.stem] || ''}${BRANCHES[palace.branch] || ''}${labels.length ? `；${labels.join('、')}` : ''}）：` +
      `${stars.length ? stars.join('、') : '无主星'}${selfSihua.length ? `；${selfSihua.join('、')}` : ''}` +
      `${palace.isEmpty && palace.borrowedFromName ? `；空宫借${safeText(palace.borrowedFromName)}宫：${palace.borrowedStars?.map(s => safeText(s)).join('、') || '未提供'}` : ''}`,
    );
  }
  return lines.join('\n').slice(0, 12000);
}
