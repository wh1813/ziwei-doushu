'use client';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useTheme } from './ThemeProvider';
import { getSkin } from '@/lib/ui/theme';

/**
 * 6 模块统一顶部导航：紫微排盘 / 手相 / 奇门 / 六爻 / 大六壬 / 小六壬 + 主题切换。
 * 各页面通过 import 共用，消除"页面长得一样"与"无法跨页跳转"两个体验问题。
 *
 * R18-9：皮肤色板改用 lib/ui/theme.ts（暗金鎏光统一 token），与首页保持一致。
 */
export default function TopNav() {
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';
  const skin = getSkin(theme);

  const items = [
    { key: 'chart',       label: '紫微排盘', path: '/chart' },
    { key: 'palm',        label: '手相',     path: '/palm' },
    { key: 'qimen',       label: '奇门',     path: '/qimen' },
    { key: 'liuyao',      label: '六爻',     path: '/liuyao' },
    { key: 'daliuren',    label: '大六壬',   path: '/daliuren' },
    { key: 'xiaoliuren',  label: '小六壬',   path: '/xiaoliuren' },
  ];

  // 暗金鎏光导航条（暗色主题）/ 米金（亮色）
  const navBg        = isDark ? 'rgba(11, 13, 19, 0.88)' : 'rgba(248, 243, 232, 0.94)';
  const navBorder    = isDark ? 'rgba(212, 175, 55, 0.20)' : 'rgba(140, 100, 20, 0.25)';
  const navText      = isDark ? skin.goldLight : '#7A5810';
  const navItemBg    = 'transparent';
  const navItemHover  = isDark ? 'rgba(212, 175, 55, 0.08)' : 'rgba(184, 144, 28, 0.08)';
  const toggleBg     = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 252, 242, 0.95)';
  const toggleBorder = isDark ? 'rgba(212, 175, 55, 0.35)' : 'rgba(140, 100, 20, 0.45)';
  const toggleDot    = isDark
    ? 'linear-gradient(135deg, #F5E6A3, #D4AF37)'
    : 'linear-gradient(135deg, #B8901C, #F5E6A3)';
  const toggleRail   = isDark ? 'rgba(11, 13, 19, 0.6)' : 'rgba(184, 144, 28, 0.55)';

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between gap-2 px-3 sm:px-6 py-2.5 sm:py-3 backdrop-blur-md"
      style={{
        background: navBg,
        borderBottom: `1px solid ${navBorder}`,
      }}
    >
      {/* 左侧：返回首页 */}
      <button
        onClick={() => router.push('/')}
        className="text-[11px] sm:text-xs px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full transition-colors"
        style={{
          color: navText,
          border: `1px solid ${navBorder}`,
          background: 'transparent',
        }}
        onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = navItemHover; }}
        onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = navItemBg; }}
        aria-label="返回首页"
      >
        ← 首页
      </button>

      {/* 中间：6 个模块入口 */}
      <div className="flex items-center gap-1 sm:gap-2 flex-1 justify-center overflow-x-auto">
        {items.map(it => (
          <motion.button
            key={it.key}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => router.push(it.path)}
            className="text-[10px] sm:text-xs px-2 sm:px-3 py-1 sm:py-1.5 rounded-full whitespace-nowrap"
            style={{
              color: navText,
              border: `1px solid ${navBorder}`,
              background: 'transparent',
              fontFamily: skin.fontSerif,
            }}
            onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = navItemHover; }}
            onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = navItemBg; }}
          >
            {it.label}
          </motion.button>
        ))}
      </div>

      {/* 右侧：主题切换 */}
      <button
        onClick={toggle}
        className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full transition-colors flex-shrink-0"
        style={{
          color: navText,
          border: toggleBorder,
          background: toggleBg,
        }}
        aria-label={isDark ? '切换亮色主题' : '切换暗色主题'}
      >
        <div className="relative w-7 h-3.5 rounded-full" style={{ background: toggleRail }}>
          <div
            className="absolute top-0.5 w-2.5 h-2.5 rounded-full transition-all duration-300"
            style={{
              left: isDark ? 2 : 14,
              background: toggleDot,
            }}
          />
        </div>
        <span className="text-[10px] font-medium hidden sm:inline">
          {isDark ? '暗色' : '亮色'}
        </span>
      </button>
    </nav>
  );
}