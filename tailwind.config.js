/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Ramses Exchange Dark Mode Theme
        bg: {
          base:    '#070A10',                  // Ultra dark background
          surface: '#0B0F19',                  // Card & table surface
          raised:  '#101524',                  // Elevated row/container
          border:  '#192134',                  // Clean slate border
          hover:   '#151C2D',                  // Row hover state
        },
        ramses: {
          cyan:    '#38BDF8',                  // Ramses APR cyan
          blue:    '#60A5FA',                  // Ramses highlight blue
          white:   '#FFFFFF',                  // Primary action CTA
          darkBtn: '#181E2C',                  // Deposit action button background
          darkBtnHover: '#222A3E',             // Deposit action button hover
          darkBtnBorder: '#283248',            // Deposit action button border
        },
        // Primary AEON & Ramses accents
        aeon: {
          50:  '#F0F9FF',
          100: '#E0F2FE',
          200: '#BAE6FD',
          300: '#7DD3FC',
          400: '#38BDF8',  // Ramses electric cyan accent
          500: '#0EA5E9',
          600: '#0284C7',
          700: '#0369A1',
          800: '#075985',
          900: '#0C4A6E',
        },
        // Gold token accent
        gold: {
          400: '#FFB800',
          500: '#E6A500',
        },
        // Secondary violet for governance
        violet: {
          400: '#A78BFA',
          500: '#8B5CF6',
          600: '#7C3AED',
        },
        // Success green
        emerald: {
          400: '#34D399',
          500: '#10B981',
        },
        // Text scale - high contrast Ramses crisp typography
        text: {
          primary:   '#F8FAFC',  // slate-50 bright white
          secondary: '#94A3B8',  // slate-400 muted text
          muted:     '#64748B',  // slate-500 subtext
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        sans:    ['var(--font-sans)',    'system-ui', 'sans-serif'],
        mono:    ['var(--font-mono)',    'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '1rem' }],
      },
      backgroundImage: {
        'aeon-glow':    'radial-gradient(ellipse 60% 40% at 50% 0%, rgba(16,185,129,0.12) 0%, transparent 70%)',
        'violet-glow':  'radial-gradient(ellipse 60% 40% at 50% 0%, rgba(139,92,246,0.10) 0%, transparent 70%)',
      },
      animation: {
        'pulse-slow':   'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow':         'glow 2s ease-in-out infinite alternate',
        'slide-up':     'slideUp 0.3s ease-out forwards',
        'fade-in':      'fadeIn 0.2s ease-out forwards',
      },
      keyframes: {
        glow: {
          '0%':   { boxShadow: '0 0 5px rgba(16,185,129,0.2)' },
          '100%': { boxShadow: '0 0 20px rgba(16,185,129,0.4)' },
        },
        slideUp: {
          '0%':   { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)',   opacity: '1' },
        },
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      borderRadius: {
        'xl2': '1rem',
        'xl3': '1.5rem',
      },
    },
  },
  plugins: [],
}
