/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Tokens semánticos -> variables CSS (canales RGB para soportar /alpha).
        // Los valores reales viven en index.css ([data-theme="dark"|"light"]).
        bg: {
          DEFAULT: 'rgb(var(--bg) / <alpha-value>)',
          elevated: 'rgb(var(--bg-elevated) / <alpha-value>)',
          surface: 'rgb(var(--bg-surface) / <alpha-value>)',
          border: 'rgb(var(--bg-border) / <alpha-value>)',
        },
        fg: {
          DEFAULT: 'rgb(var(--fg) / <alpha-value>)',
          muted: 'rgb(var(--fg-muted) / <alpha-value>)',
          subtle: 'rgb(var(--fg-subtle) / <alpha-value>)',
        },
        bull: 'rgb(var(--bull) / <alpha-value>)',
        bear: 'rgb(var(--bear) / <alpha-value>)',
        amber: {
          glow: 'rgb(var(--amber-glow) / <alpha-value>)',
          DEFAULT: 'rgb(var(--amber) / <alpha-value>)',
          deep: 'rgb(var(--amber-deep) / <alpha-value>)',
        },
        cyan: {
          glow: 'rgb(var(--cyan-glow) / <alpha-value>)',
          DEFAULT: 'rgb(var(--cyan) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
        display: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        '2xs': '0.6875rem',
      },
      animation: {
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'flash-bull': 'flash-bull 0.6s ease-out',
        'flash-bear': 'flash-bear 0.6s ease-out',
      },
      keyframes: {
        'flash-bull': {
          '0%': { backgroundColor: 'rgba(34, 197, 94, 0.2)' },
          '100%': { backgroundColor: 'transparent' },
        },
        'flash-bear': {
          '0%': { backgroundColor: 'rgba(239, 68, 68, 0.2)' },
          '100%': { backgroundColor: 'transparent' },
        },
      },
    },
  },
  plugins: [],
};
