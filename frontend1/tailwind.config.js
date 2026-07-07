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
          // Dark mode: a graduated true-neutral-gray elevation ladder (base → card → hover),
          // each step ~4-5% lighter. Zero blue/navy hue — a warm-neutral charcoal, not slate.
          dark: '#0c0c0d', // page base — near-black neutral gray
          'dark-subtle': '#17171a', // cards / dialogs / popovers — one step up
          'dark-muted': '#212124', // hover / active states — two steps up
        },
        border: {
          DEFAULT: '#e2e8f0', // slate-200
          dark: '#34343a', // visible enough to define card/table edges without being harsh
        },
        ink: {
          DEFAULT: '#0f172a', // slate-900 — primary text
          muted: '#475569', // slate-600 — secondary text
          subtle: '#aeaeb6', // neutral gray — tertiary/placeholder; lightened for dark-mode legibility
          inverted: '#ececee', // off-white, neutral hue — avoids glare of pure-white text
        },
        // Disciplined single accent for primary actions/focus — a muted, desaturated
        // teal rather than blue, so it reads as calm/professional, not "tech-SaaS blue."
        accent: {
          50: '#eef6f4',
          100: '#d7ebe6',
          200: '#b0d7cd',
          300: '#84beb1',
          400: '#5aa294',
          500: '#3d8678',
          600: '#306b60',
          700: '#28564d',
          800: '#224540',
          900: '#1d3a35',
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
