/**
 * 全站 UI 皮肤常量 — R18-9 暗金主题
 *
 * 架构约束：保留项目现有 inline style + framer-motion 风格，所有页面通过
 * `import { darkTheme, lightTheme } from '@/lib/ui/theme'` 引用同一套色板与阴影，
 * 不引入 tailwind.config.ts、不抽离 per-page 组件，避免破坏既有架构。
 *
 * 设计语言来源：用户提供的 R18-9 参考稿（暗金鎏光 + 四化彩色 token）。
 * 转化原则：取参考稿的色值与视觉层级，落到 inline style 可直接消费的 TS 常量。
 */

import type { Theme } from '@/components/ThemeProvider';

// ─── 暗金主题（dark / 默认） ─────────────────────────────────────
export const darkTheme = {
  // 背景三层
  bgBase:       '#0B0D13',                       // 深玄背景底色
  bgSurface:    '#141722',                       // 拟态卡片背景
  bgElevated:   '#1B202F',                       // 浮层 / 高亮
  bgInput:      '#0D1017',                       // 输入控件底

  // 金色四阶
  gold:         '#D4AF37',                       // 东方星金（accent / CTA）
  goldLight:    '#F5E6A3',                       // 浅金高光（标题）
  goldMuted:    '#8C7322',                       // 暗金边框（次级）
  goldGlow:     'rgba(212, 175, 55, 0.16)',     // 金光晕

  // 四化彩色 token
  sihuaLu:      '#10B981',                       // 化禄 翠绿
  sihuaQuan:    '#3B82F6',                       // 化权 群青
  sihuaKe:      '#A855F7',                       // 化科 绛紫
  sihuaJi:      '#EF4444',                       // 化忌 赤红
  shaOrange:    '#F97316',                       // 煞星 橙火

  // 文本四阶
  textPrimary:  '#E8EEF6',
  textSecond:   '#B8C6DF',
  textMuted:    '#9DB0D0',
  textDim:      '#5A6275',
  textOnGold:   '#08080A',                       // 金底上的文字

  // 边框三阶
  borderSubtle: 'rgba(255, 255, 255, 0.06)',
  border:       'rgba(255, 255, 255, 0.12)',
  borderStrong: 'rgba(212, 175, 55, 0.35)',
  borderGold:   'rgba(212, 175, 55, 0.25)',

  // 阴影三阶
  shadowGlow:   '0 0 24px rgba(212, 175, 55, 0.16)',
  shadowCard:   '0 8px 32px rgba(0, 0, 0, 0.36)',
  shadowSoft:   '0 4px 16px rgba(0, 0, 0, 0.24)',

  // 光晕背景（hero / 页脚）
  glowTint:     'rgba(212, 175, 55, 0.07)',
  glowBlue:     'rgba(40, 80, 160, 0.12)',
  glowPurple:   'rgba(120, 50, 180, 0.08)',

  // 字体
  fontSerif:    '"Noto Serif SC", "Songti SC", serif',
  fontSans:     'Inter, "PingFang SC", sans-serif',
} as const;

// ─── 亮色主题（light，可选） ─────────────────────────────────────
export const lightTheme = {
  bgBase:       '#F8F3E8',
  bgSurface:    '#FFFDF5',
  bgElevated:   '#FFFFFF',
  bgInput:      '#FAF6E8',

  gold:         '#B8901C',
  goldLight:    '#7A5810',
  goldMuted:    '#8C7322',
  goldGlow:     'rgba(184, 144, 28, 0.16)',

  sihuaLu:      '#059669',
  sihuaQuan:    '#2563EB',
  sihuaKe:      '#9333EA',
  sihuaJi:      '#DC2626',
  shaOrange:    '#EA580C',

  textPrimary:  '#1A1D24',
  textSecond:   '#3A3F4A',
  textMuted:    '#5A6275',
  textDim:      '#8A8F9A',
  textOnGold:   '#F8F3E8',

  borderSubtle: 'rgba(140, 100, 20, 0.10)',
  border:       'rgba(140, 100, 20, 0.20)',
  borderStrong: 'rgba(184, 144, 28, 0.45)',
  borderGold:   'rgba(184, 144, 28, 0.30)',

  shadowGlow:   '0 0 24px rgba(184, 144, 28, 0.14)',
  shadowCard:   '0 8px 32px rgba(140, 100, 20, 0.12)',
  shadowSoft:   '0 4px 16px rgba(140, 100, 20, 0.08)',

  glowTint:     'rgba(184, 144, 28, 0.06)',
  glowBlue:     'rgba(58, 90, 130, 0.06)',
  glowPurple:   'rgba(96, 80, 140, 0.04)',

  fontSerif:    '"Noto Serif SC", "Songti SC", serif',
  fontSans:     'Inter, "PingFang SC", sans-serif',
} as const;

export type Skin = typeof darkTheme;

/** 共享皮肤接口（dark / light 共用字段名，仅字面量值不同） */
export interface ISkin {
  bgBase: string;
  bgSurface: string;
  bgElevated: string;
  bgInput: string;
  gold: string;
  goldLight: string;
  goldMuted: string;
  goldGlow: string;
  sihuaLu: string;
  sihuaQuan: string;
  sihuaKe: string;
  sihuaJi: string;
  shaOrange: string;
  textPrimary: string;
  textSecond: string;
  textMuted: string;
  textDim: string;
  textOnGold: string;
  borderSubtle: string;
  border: string;
  borderStrong: string;
  borderGold: string;
  shadowGlow: string;
  shadowCard: string;
  shadowSoft: string;
  glowTint: string;
  glowBlue: string;
  glowPurple: string;
  fontSerif: string;
  fontSans: string;
}

/** 按 ThemeProvider 的 theme 取对应 skin */
export function getSkin(theme: Theme | 'dark' | 'light' | undefined | null): ISkin {
  return (theme === 'light' ? lightTheme : darkTheme) as ISkin;
}

/** 四化色 token 映射（'禄' / '权' / '科' / '忌'） */
export const sihuaColors = {
  lu:   darkTheme.sihuaLu,
  quan: darkTheme.sihuaQuan,
  ke:   darkTheme.sihuaKe,
  ji:   darkTheme.sihuaJi,
} as const;

export type SihuaKey = keyof typeof sihuaColors;