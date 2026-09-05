'use client';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useTheme } from './ThemeProvider';

/**
 * 6 模块统一顶部导航：紫微排盘 / 手相 / 奇门 / 六爻 / 大六壬 / 小六壬 + 主题切换。
 * 各页面通过 import 共用，消除"页面长得一样"与"无法跨页跳转"两个体验问题。
 */
export default function TopNav() {
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';

  const items = [
    { key: 'chart',       label: '紫微排盘', path: '/chart' },
    { key: 'palm',        label: '手相',     path: '/palm' },
    { key: 'qimen',       label: '奇门',     path: '/qimen' },
    { key: 'liuyao',      label: '六爻',     path: '/liuyao' },
    { key: 'daliuren',    label: '大六壬',   path: '/daliuren' },
    { key: 'xiaoliuren',  label: '小六壬',   path: '/xiaoliuren' },
  ];

  // 主题色：dark 用半透明白底 + 金线，light 用金底白字
  const navBg = isDark ? 'rgba(2, 8, 16, 0.85)' : 'rgba(245, 239, 224, 0.92)';
  const navBorder = isDark ? 'rgba(212,168,67,0.25)' : 'rgba(140,100,20,0.30)';
  const navText = isDark ? 'rgba(212,180,100,0.95)' : 'rgba(110,72,8,0.95)';
  const toggleBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,252,242,0.95)';
  const toggleBorder = isDark ? 'rgba(212,168,67,0.35)' : 'rgba(140,100,20,0.45)';

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
            className="text-[10px] sm:text-xs px-2 sm:px-3 py-1 sm:py-1.5 rounded-full whitespace-nowrap transition-colors"
            style={{
              color: navText,
              border: `1px solid ${navBorder}`,
              background: 'transparent',
            }}
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
        <div
          className="relative w-7 h-3.5 rounded-full"
          style={{
            background: isDark ? 'rgba(12,24,64,0.95)' : 'rgba(230,195,80,0.55)',
          }}
        >
          <div
            className="absolute top-0.5 w-2.5 h-2.5 rounded-full transition-all duration-300"
            style={{
              left: isDark ? 2 : 14,
              background: isDark
                ? 'linear-gradient(135deg, #b8a050, #e8d090)'
                : 'linear-gradient(135deg, #e89010, #f8d050)',
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