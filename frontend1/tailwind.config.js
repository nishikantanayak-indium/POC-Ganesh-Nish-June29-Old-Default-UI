/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        // Neutral surfaces — slate for cool neutrals, zinc for warmer chrome.
        surface: {
          DEFAULT: '#ffffff',
          subtle: '#f8fafc', // slate-50
          muted: '#f1f5f9', // slate-100
          dark: '#0f172a', // slate-900
          'dark-subtle': '#1e293b', // slate-800
          'dark-muted': '#334155', // slate-700
        },
        border: {
          DEFAULT: '#e2e8f0', // slate-200
          dark: '#334155', // slate-700
        },
        ink: {
          DEFAULT: '#0f172a', // slate-900 — primary text
          muted: '#475569', // slate-600 — secondary text
          subtle: '#94a3b8', // slate-400 — tertiary/placeholder
          inverted: '#f8fafc',
        },
        // Authoritative navy — primary chrome, headers, active nav.
        navy: {
          50: '#f0f4f9',
          100: '#dae3ee',
          200: '#b7c8dd',
          300: '#8ea6c6',
          400: '#5f7fa8',
          500: '#3f5f87',
          600: '#2c4a6e',
          700: '#213A59',
          800: '#182B42',
          900: '#101D2C',
          950: '#0a141d',
        },
        // Disciplined single accent for primary actions/focus.
        accent: {
          50: '#eef4ff',
          100: '#dae7ff',
          200: '#b9d2ff',
          300: '#8cb4ff',
          400: '#5c8fff',
          500: '#3568f0',
          600: '#254fcc',
          700: '#1f3fa3',
          800: '#1d3684',
          900: '#1c306b',
        },
        // Semantic status — reused across pipeline, coverage, risk, SME verdicts, chat intents.
        success: {
          50: '#f0fdf6',
          100: '#dcfce9',
          400: '#4ade80',
          500: '#16a34a',
          600: '#15803d',
          700: '#166534',
        },
        warning: {
          50: '#fffbeb',
          100: '#fef3c7',
          400: '#fbbf24',
          500: '#d97706',
          600: '#b45309',
          700: '#92400e',
        },
        danger: {
          50: '#fef2f2',
          100: '#fee2e2',
          400: '#f87171',
          500: '#dc2626',
          600: '#b91c1c',
          700: '#991b1b',
        },
        info: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          400: '#38bdf8',
          500: '#0284c7',
          600: '#0369a1',
          700: '#075985',
        },
      },
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.875rem', { lineHeight: '1.5rem' }],
        md: ['0.9375rem', { lineHeight: '1.5rem' }],
        lg: ['1.0625rem', { lineHeight: '1.625rem' }],
        xl: ['1.25rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)',
        'card-hover': '0 2px 4px 0 rgb(15 23 42 / 0.06), 0 4px 8px -2px rgb(15 23 42 / 0.08)',
        popover: '0 4px 6px -2px rgb(15 23 42 / 0.05), 0 12px 24px -4px rgb(15 23 42 / 0.12)',
      },
      borderRadius: {
        DEFAULT: '0.375rem',
      },
    },
  },
  plugins: [],
}
