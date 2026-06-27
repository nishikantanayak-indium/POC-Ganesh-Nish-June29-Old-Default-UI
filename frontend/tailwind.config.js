/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#09090f',
        surface: '#111118',
        card: '#16161f',
        border: '#252535',
        primary: '#6366f1',
        'primary-dim': '#4f46e5',
        success: '#10b981',
        warning: '#f59e0b',
        danger: '#ef4444',
        purple: '#8b5cf6',
        muted: '#94a3b8',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}
