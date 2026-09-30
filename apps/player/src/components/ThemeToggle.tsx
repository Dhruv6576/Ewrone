'use client';

import { useTheme } from './ThemeProvider';
import { Sun, Moon } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="w-9 h-9 rounded-xl bg-slate-800/40 border border-slate-700/50 animate-pulse" />
    );
  }

  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      className="relative w-11 h-6 rounded-full bg-slate-900 border border-slate-700/80 p-0.5 transition-all flex items-center cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#00df81]/40"
    >
      <div
        className={`w-4.5 h-4.5 rounded-full transition-transform duration-200 shadow-sm ${
          isDark
            ? 'translate-x-5 bg-[#00df81] shadow-[#00df81]/50'
            : 'translate-x-0.5 bg-slate-400'
        }`}
      />
      <span className="sr-only">Toggle theme</span>
    </button>
  );
}
