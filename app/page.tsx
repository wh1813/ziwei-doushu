'use client';
import { useLayoutEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, useScroll, useTransform } from 'framer-motion';
import StarField from '@/components/StarField';
import TopNav from '@/components/TopNav';
import { useTheme } from '@/components/ThemeProvider';
import { getSkin, type ISkin } from '@/lib/ui/theme';

// ─── 主页卡片 accent → 主题色映射（R18-9 暗金鎏光 + 四化彩色 token）──
type Accent = 'gold' | 'purple' | 'teal' | 'indigo' | 'cyan' | 'blue';
function accentPair(skin: ISkin, a: Accent): { color: string; border: string } {
  switch (a) {
    case 'gold':   return { color: skin.goldLight,  border: skin.borderGold };
    case 'purple': return { color: skin.sihuaKe,    border: 'rgba(168,85,247,0.40)' };
    case 'teal':   return { color: skin.sihuaLu,    border: 'rgba(16,185,129,0.40)' };
    case 'indigo': return { color: skin.sihuaQuan,  border: 'rgba(99,102,241,0.40)' };
    case 'cyan':   return { color: '#06b6d4',       border: 'rgba(6,182,212,0.40)' };
    case 'blue':   return { color: '#3a78d4',       border: 'rgba(96,165,250,0.40)' };
  }
}

// ─── 功能入口卡片 ─────────────────────────────────────────
const ENTRIES = [
  { key: 'chart',       title: '紫微斗数排盘', desc: '输入出生年月日时，生成专属命盘，AI 按倪海夏体系深度解读。',
    sigil: '命宫十四主 · 三方四正', cta: '立即起盘', icon: '◉', accent: 'gold' as Accent },
  { key: 'palm',        title: '手相 / 面相',   desc: '上传手掌或面部照片，AI 识掌纹/三庭五眼，解读性格、事业与感情。',
    sigil: '三才纹 · 三庭五眼',     cta: '开始分析', icon: '✋', accent: 'blue' as Accent },
  { key: 'qimen',       title: '奇门遁甲',     desc: '确定性起局排盘零幻觉，AI 依用神与格局解盘，给出方位与时机建议。',
    sigil: '洛书九宫 · 阴阳遁十八局', cta: '开始起局', icon: '▦', accent: 'teal' as Accent },
  { key: 'liuyao',      title: '六爻起卦',     desc: '按京房纳甲法起卦，AI 依用神与动爻解卦，预测所问之事的成与不成。',
    sigil: '京房纳甲 · 六爻安世应',  cta: '开始起卦', icon: '☰', accent: 'purple' as Accent },
  { key: 'daliuren',    title: '大六壬起课',   desc: '依月将加时起天地盘，AI 依贼克、比用、涉害三法推导四课三传，详断所占吉凶。',
    sigil: '月将加时 · 四课三传',    cta: '开始起课', icon: '☵', accent: 'indigo' as Accent },
  { key: 'xiaoliuren',  title: '小六壬掌诀',   desc: '诸葛马前课，仅用月日时三步掌诀顺数，掐指一算当即立断。',
    sigil: '大安起月 · 掐指即得',    cta: '掐指起课', icon: '☷', accent: 'cyan' as Accent },
];

// ─── 主页 ───────────────────────────────────────────
export default function HomePage() {
  const router = useRouter();
  const { theme } = useTheme();
  const skin = getSkin(theme);

  const heroRef = useRef(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] });
  const heroY = useTransform(scrollYProgress, [0, 1], ['0%', '20%']);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.6], [1, 0]);

  useLayoutEffect(() => {
    document.documentElement.style.background = skin.bgBase;
    document.body.style.background = skin.bgBase;
    return () => {
      document.documentElement.style.background = '';
      document.body.style.background = '';
    };
  }, [skin.bgBase]);

  return (
    <div style={{ background: skin.bgBase, transition: 'background 0.35s ease' }} className="overflow-x-hidden">
      <StarField />

      {/* 全局光晕 */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] rounded-full"
          style={{ background: `radial-gradient(ellipse, ${skin.glowTint} 0%, transparent 70%)` }} />
        <div className="absolute top-1/3 left-1/4 w-96 h-96 rounded-full"
          style={{ background: `radial-gradient(ellipse, ${skin.glowBlue} 0%, transparent 70%)` }} />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 rounded-full"
          style={{ background: `radial-gradient(ellipse, ${skin.glowPurple} 0%, transparent 70%)` }} />
      </div>

      <TopNav />

      {/* ══ HERO ══ */}
      <section ref={heroRef} className="relative min-h-[86svh] flex flex-col items-center justify-center px-6 z-10 pt-16">
        <motion.div style={{ y: heroY, opacity: heroOpacity, maxWidth: '960px' }} className="text-center w-full mx-auto">
          {/* 顶部 tag chip + 主标题 + 副标题 */}
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.2, ease: [0.25, 0.1, 0.25, 1] }}>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full mb-6"
              style={{
                border: `1px solid ${skin.borderStrong}`,
                background: 'rgba(212,175,55,0.05)',
                color: skin.gold,
                fontFamily: skin.fontSerif,
              }}>
              <span className="text-xs tracking-widest">✦ 先天命造 · 真太阳时精算</span>
            </div>
            <h1
              className={`grad-text ${theme === 'dark' ? 'grad-text-dark' : 'grad-text-light'} font-bold leading-none mb-3`}
              style={{
                fontFamily: skin.fontSerif,
                fontSize: 'clamp(56px, 11vw, 140px)',
                letterSpacing: '0.07em',
                textShadow: theme === 'dark' ? '0 0 40px rgba(245,230,163,0.35), 0 0 80px rgba(212,175,55,0.18)' : 'none',
              }}>
              私人命理
            </h1>
            <p className="text-xs sm:text-sm max-w-lg mx-auto mb-12"
              style={{ color: skin.textMuted, fontFamily: skin.fontSerif }}>
              恪遵古法三合四化秘要，厘定十二宫干支神煞，探微知命以立人事。
            </p>
          </motion.div>

          {/* 六大功能入口卡片 */}
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.6 }}
            className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-4xl mx-auto">
            {ENTRIES.map((e) => {
              const a = accentPair(skin, e.accent);
              const isGold = e.accent === 'gold';
              return (
                <motion.button
                  key={e.key}
                  whileHover={{ y: -4 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => router.push(`/${e.key}`)}
                  className="group rounded-2xl p-8 text-left cursor-pointer transition-all duration-300"
                  style={{
                    background: skin.bgSurface,
                    border: `1px solid ${a.border}`,
                    boxShadow: isGold ? `${skin.shadowCard}, ${skin.shadowGlow}` : skin.shadowCard,
                  }}>
                  {/* 顶部 icon + sigil */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="text-3xl" style={{ color: a.color }}>{e.icon}</div>
                    <div className="text-[10px] tracking-[0.2em] font-mono uppercase opacity-80" style={{ color: a.color }}>{e.sigil}</div>
                  </div>
                  <div className="text-xl font-semibold mb-1.5 tracking-wide"
                    style={{ color: skin.textPrimary, fontFamily: skin.fontSerif }}>{e.title}</div>
                  <div className="text-xs leading-relaxed mb-5" style={{ color: skin.textMuted }}>{e.desc}</div>
                  <div className="text-[12px] tracking-widest flex items-center gap-2" style={{ color: a.color }}>
                    <span>{e.cta}</span>
                    <span style={{ opacity: 0.7 }}>→</span>
                  </div>
                </motion.button>
              );
            })}
          </motion.div>
        </motion.div>
      </section>

      {/* ══ Footer：仅最小合规声明 ══ */}
      <footer className="relative z-10 py-8 px-6"
        style={{ borderTop: `1px solid ${skin.borderSubtle}` }}>
        <div className="text-center">
          <p className="text-[10px] tracking-wider mb-2" style={{ color: skin.textMuted }}>
            私人命理 · 仅供娱乐参考
          </p>
          <p className="text-[10px] tracking-wider" style={{ color: skin.textMuted, opacity: 0.85 }}>
            <a href="/terms" style={{ textDecoration: 'underline' }}>服务条款</a>
            {' · '}
            <a href="/privacy" style={{ textDecoration: 'underline' }}>隐私政策</a>
          </p>
        </div>
      </footer>
    </div>
  );
}