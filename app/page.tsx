'use client';
import { useLayoutEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, useScroll, useTransform } from 'framer-motion';
import StarField from '@/components/StarField';
import TopNav from '@/components/TopNav';
import { useTheme, type Theme } from '@/components/ThemeProvider';

// ─── 主题色彩 helper（沿用首页既有体系，仅保留核心色）────────────────────
function useColors(theme: Theme) {
  const d = theme === 'dark';
  return {
    bgBase:      d ? '#020810'                            : '#f5efe0',
    navBg:       d ? '#020810'                            : '#f5efe0',
    navBorder:   d ? 'rgba(255,255,255,0.05)'            : 'rgba(160,120,30,0.15)',
    goldGrad:    d ? 'linear-gradient(160deg,#c8993a 0%,#f0d070 40%,#c8993a 70%,#f0c755 100%)'
                   : 'linear-gradient(160deg,#6a4206 0%,#9a6a10 40%,#6a4206 70%,#885010 100%)',
    goldSolid:   d ? '#d4a843'                           : '#8b6410',
    goldLine:    d ? 'rgba(212,168,67,0.4)'              : 'rgba(140,100,20,0.4)',
    tagText:     d ? 'rgba(212,168,67,0.6)'              : 'rgba(120,80,10,0.65)',
    textPrimary: d ? '#e8eef6'                           : '#1a1d24',
    textSecond:  d ? '#b8c6df'                           : '#3a3f4a',
    textMuted:   d ? '#9db0d0'                           : '#5a6275',
    cardBg:      d ? 'rgba(255,255,255,0.05)'            : 'rgba(255,255,255,0.88)',
    cardBorder:  d ? 'rgba(255,255,255,0.10)'            : 'rgba(200,160,60,0.25)',
    cardShadow:  d ? '0 4px 32px rgba(0,0,0,0.5)'        : '0 4px 24px rgba(140,100,20,0.12)',
    ctaBg:       d ? 'linear-gradient(135deg,#b8892a,#f0d070,#b8892a)'
                    : 'linear-gradient(135deg,#6a4206,#9a6810,#6a4206)',
    ctaText:     d ? '#08080a'                           : '#f8f3e8',
    footerText:  d ? 'rgba(212,180,110,0.55)'           : '#7a5a18',
    glowTint:    d ? 'rgba(212,168,67,0.07)'             : 'rgba(180,140,40,0.06)',
    glowBlue:    d ? 'rgba(40,80,160,0.12)'              : 'rgba(58,90,130,0.06)',
    glowPurple:  d ? 'rgba(120,50,180,0.08)'             : 'rgba(96,80,140,0.04)',
  };
}

// ─── 主星数据（hero 点缀）─────────────────────────────────
const STARS = [
  { name: '紫微' }, { name: '天机' }, { name: '太阳' }, { name: '武曲' },
  { name: '天同' }, { name: '廉贞' }, { name: '天府' }, { name: '太阴' },
  { name: '贪狼' }, { name: '巨门' }, { name: '天相' }, { name: '天梁' },
  { name: '七杀' }, { name: '破军' },
];

// ─── 功能入口卡片 ─────────────────────────────────────────
const ENTRIES = [
  {
    key: 'chart',
    title: '紫微斗数排盘',
    desc: '输入出生年月日时，生成专属命盘，AI 按倪海夏体系深度解读。',
    sigil: '命宫十四主 · 三方四正',
    cta: '立即起盘',
    icon: '◉',
    accent: 'gold',
  },
  {
    key: 'palm',
    title: '手相 / 面相',
    desc: '上传手掌或面部照片，AI 识掌纹/三庭五眼，解读性格、事业与感情。',
    sigil: '三才纹 · 三庭五眼',
    cta: '开始分析',
    icon: '✋',
    accent: 'blue',
  },
  {
    key: 'qimen',
    title: '奇门遁甲',
    desc: '确定性起局排盘零幻觉，AI 依用神与格局解盘，给出方位与时机建议。',
    sigil: '洛书九宫 · 阴阳遁十八局',
    cta: '开始起局',
    icon: '▦',
    accent: 'teal',
  },
  {
    key: 'liuyao',
    title: '六爻起卦',
    desc: '按京房纳甲法起卦，AI 依用神与动爻解卦，预测所问之事的成与不成。',
    sigil: '京房纳甲 · 六爻安世应',
    cta: '开始起卦',
    icon: '☰',
    accent: 'purple',
  },
  {
    key: 'daliuren',
    title: '大六壬起课',
    desc: '依月将加时起天地盘，AI 依贼克、比用、涉害三法推导四课三传，详断所占吉凶。',
    sigil: '月将加时 · 四课三传',
    cta: '开始起课',
    icon: '☵',
    accent: 'indigo',
  },
  {
    key: 'xiaoliuren',
    title: '小六壬掌诀',
    desc: '诸葛马前课，仅用月日时三步掌诀顺数，掐指一算当即立断。',
    sigil: '大安起月 · 掐指即得',
    cta: '掐指起课',
    icon: '☷',
    accent: 'cyan',
  },
  {
    key: 'fortune',
    title: '运势中心',
    desc: '把已起好的 1-4 个术数盘面粘贴进来，跨模块交叉印证，按本月/本季/本年与聚焦维度给综合报告。',
    sigil: '跨盘印证 · 五段结构',
    cta: '进入运势中心',
    icon: '✧',
    accent: 'fuchsia',
  },
];

// ─── 主页（精简版：排盘 + 手相 + 奇门）─────────────────────
export default function HomePage() {
  const router = useRouter();
  const { theme } = useTheme();
  const c = useColors(theme);

  const heroRef = useRef(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] });
  const heroY = useTransform(scrollYProgress, [0, 1], ['0%', '20%']);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.6], [1, 0]);

  useLayoutEffect(() => {
    document.documentElement.style.background = c.bgBase;
    document.body.style.background = c.bgBase;
    return () => {
      document.documentElement.style.background = '';
      document.body.style.background = '';
    };
  }, [c.bgBase]);

  return (
    <div style={{ background: c.bgBase, transition: 'background 0.35s ease' }} className="overflow-x-hidden">
      <StarField />

      {/* 全局光晕 */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] rounded-full"
          style={{ background: `radial-gradient(ellipse, ${c.glowTint} 0%, transparent 70%)` }} />
        <div className="absolute top-1/3 left-1/4 w-96 h-96 rounded-full"
          style={{ background: `radial-gradient(ellipse, ${c.glowBlue} 0%, transparent 70%)` }} />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 rounded-full"
          style={{ background: `radial-gradient(ellipse, ${c.glowPurple} 0%, transparent 70%)` }} />
      </div>

      {/* ── 顶部导航（统一 TopNav 组件） ── */}
      <TopNav />

      {/* ══ HERO ══ */}
      <section ref={heroRef} className="relative min-h-[86svh] flex flex-col items-center justify-center px-6 z-10 pt-16">
        <motion.div style={{ y: heroY, opacity: heroOpacity, maxWidth: '960px' }} className="text-center w-full mx-auto">
          {/* 主标题 */}
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.2, ease: [0.25, 0.1, 0.25, 1] }}>
            <h1
              className={`grad-text ${theme === 'dark' ? 'grad-text-dark' : 'grad-text-light'} font-bold leading-none mb-6`}
              style={{
                fontSize: 'clamp(56px, 11vw, 140px)',
                letterSpacing: '0.07em',
                textShadow: theme === 'dark' ? '0 0 40px rgba(240,208,112,0.35), 0 0 80px rgba(212,168,67,0.18)' : 'none',
              }}>
              私人命理
            </h1>
          </motion.div>

          {/* 三大功能入口 */}
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.6 }}
            className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-4xl mx-auto">
            {ENTRIES.map((e) => {
              const isGold = e.accent === 'gold';
              const accentColor = e.accent === 'purple'
                ? '#a855f7'
                : e.accent === 'teal'
                  ? '#14b8a6'
                  : e.accent === 'indigo'
                    ? '#6366f1'
                    : e.accent === 'cyan'
                      ? '#06b6d4'
                      : e.accent === 'fuchsia'
                        ? '#d946ef'
                        : isGold ? c.goldSolid : '#3a78d4';
              const accentBorder = e.accent === 'purple'
                ? 'rgba(168,85,247,0.35)'
                : e.accent === 'teal'
                  ? 'rgba(20,184,166,0.35)'
                  : e.accent === 'indigo'
                    ? 'rgba(99,102,241,0.35)'
                    : e.accent === 'cyan'
                      ? 'rgba(6,182,212,0.35)'
                      : e.accent === 'fuchsia'
                        ? 'rgba(217,70,239,0.35)'
                        : isGold ? c.goldLine : 'rgba(96,165,250,0.35)';
              return (
                <motion.button
                  key={e.key}
                  whileHover={{ y: -4 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => router.push(`/${e.key}`)}
                  className="group rounded-2xl p-8 text-left cursor-pointer transition-all duration-300"
                  style={{
                    background: c.cardBg,
                    border: `1px solid ${accentBorder}`,
                    boxShadow: c.cardShadow,
                  }}>
                  <div className="text-3xl mb-4" style={{ color: accentColor }}>{e.icon}</div>
                  <div className="text-xl font-semibold mb-1.5 tracking-wide" style={{ color: c.textPrimary }}>{e.title}</div>
                  <div className="text-[10px] tracking-[0.2em] mb-2 font-mono uppercase opacity-80" style={{ color: accentColor }}>{e.sigil}</div>
                  <div className="text-xs leading-relaxed mb-5" style={{ color: c.textMuted }}>{e.desc}</div>
                  <div className="text-[12px] tracking-widest" style={{ color: accentColor }}>
                    {e.cta} →
                  </div>
                </motion.button>
              );
            })}
          </motion.div>
        </motion.div>
      </section>

      {/* ══ Footer：仅最小合规声明 ══ */}
      <footer className="relative z-10 py-8 px-6"
        style={{ borderTop: `1px solid ${c.navBorder}` }}>
        <div className="text-center">
          <p className="text-[10px] tracking-wider mb-2" style={{ color: c.footerText }}>
            私人命理 · 仅供娱乐参考
          </p>
          <p className="text-[10px] tracking-wider" style={{ color: c.footerText, opacity: 0.85 }}>
            <a href="/terms" style={{ textDecoration: 'underline' }}>服务条款</a>
            {' · '}
            <a href="/privacy" style={{ textDecoration: 'underline' }}>隐私政策</a>
          </p>
        </div>
      </footer>
    </div>
  );
}
