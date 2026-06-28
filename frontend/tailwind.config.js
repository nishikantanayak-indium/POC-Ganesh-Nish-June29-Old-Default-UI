/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg:           'var(--bg)',
        surface:      'var(--surface)',
        card:         'var(--card)',
        border:       'var(--border)',
        foreground:   'var(--foreground)',
        muted:        'var(--muted)',
        primary:      'var(--primary)',
        'primary-dim':'var(--primary-dim)',
        success:      'var(--success)',
        warning:      'var(--warning)',
        danger:       'var(--danger)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}
