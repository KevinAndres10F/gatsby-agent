/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Backgrounds (deep charcoal with warm undertone)
        bg: {
          DEFAULT: '#0a0a0c',
          elevated: '#121215',
          surface: '#1a1a1f',
          border: '#2a2a31',
        },
        // Text
        fg: {
          DEFAULT: '#e8e8ec',
          muted: '#9090a0',
          subtle: '#5a5a68',
        },
        // Semantic
        bull: '#22c55e',
        bear: '#ef4444',
        amber: {
          glow: '#fbbf24',
          DEFAULT: '#f59e0b',
          deep: '#d97706',
        },
        cyan: {
          glow: '#22d3ee',
          DEFAULT: '#06b6d4',
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
