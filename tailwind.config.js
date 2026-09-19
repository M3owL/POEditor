/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./app/index.html', './app/src/**/*.{js,jsx}'],

  /**
   * Colours resolve to CSS variables defined in `app/src/index.css`, so the
   * light/dark switch is a single class on <html> rather than a `dark:` variant
   * on every element. Opacity modifiers (`bg-surface/50`) are avoided on these
   * tokens because Tailwind cannot inject an alpha channel into a `var()`.
   */
  theme: {
    extend: {
      colors: {
        canvas: 'var(--c-canvas)',
        surface: 'var(--c-surface)',
        surface2: 'var(--c-surface-2)',
        surface3: 'var(--c-surface-3)',
        line: 'var(--c-line)',
        lineStrong: 'var(--c-line-strong)',
        fg: 'var(--c-text)',
        dim: 'var(--c-text-dim)',
        faint: 'var(--c-text-faint)',
        accent: {
          DEFAULT: 'var(--c-accent)',
          hover: 'var(--c-accent-hover)',
          soft: 'var(--c-accent-soft)',
          fg: 'var(--c-accent-fg)',
        },
        ok: 'var(--c-ok)',
        okSoft: 'var(--c-ok-soft)',
        warn: 'var(--c-warn)',
        warnSoft: 'var(--c-warn-soft)',
        err: 'var(--c-err)',
        errSoft: 'var(--c-err-soft)',
        info: 'var(--c-info)',
        infoSoft: 'var(--c-info-soft)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'JetBrains Mono', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 120ms ease-out',
        'slide-up': 'slide-up 160ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
};
