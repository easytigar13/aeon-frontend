/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // AEON Design System
        // Deep space black with warm undertone — not cold tech blue
        bg: {
          base:    '#0A0A0F',   // true deep background
          surface: '#111118',   // cards, panels
          raised:  '#18181F',   // elevated elements
          border:  '#23232D',   // borders
          hover:   '#1E1E28',   // hover states
        },
        // AEON signature: amber-gold, not generic blue/green
        aeon: {
          50:  '#FFF8E8',
          100: '#FFEFC0',
          200: '#FFE08A',
          300: '#FFCB45',
          400: '#FFB800',  // primary accent
          500: '#E6A500',
          600: '#CC9200',
          700: '#A37500',
          800: '#7A5800',
          900: '#523B00',
        },
        // Secondary: deep violet for vote/governance
        violet: {
          400: '#A78BFA',
          500: '#8B5CF6',
          600: '#7C3AED',
        },
        // Success green for positive stats
        emerald: {
          400: '#34D399',
          500: '#10B981',
        },
        // Text scale
        text: {
          primary:   '#F0EFE8',  // warm white
          secondary: '#9B9A95',  // muted
          muted:     '#5A5A60',  // very muted
        },
      },
      fontFamily: {
        // Display: geometric sans for headers
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        // Body: clean readable
        sans:    ['var(--font-sans)',    'system-ui', 'sans-serif'],
        // Numbers/data: tabular mono
        mono:    ['var(--font-mono)',    'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '1rem' }],
      },
      backgroundImage: {
        'aeon-glow':    'radial-gradient(ellipse 60% 40% at 50% 0%, rgba(255,184,0,0.12) 0%, transparent 70%)',
        'violet-glow':  'radial-gradient(ellipse 60% 40% at 50% 0%, rgba(139,92,246,0.10) 0%, transparent 70%)',
        'grid-pattern': 'linear-gradient(rgba(255,184,0,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,184,0,0.03) 1px, transparent 1px)',
      },
      backgroundSize: {
        'grid': '40px 40px',
      },
      animation: {
        'pulse-slow':   'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow':         'glow 2s ease-in-out infinite alternate',
        'count-up':     'countUp 0.5s ease-out forwards',
        'slide-up':     'slideUp 0.3s ease-out forwards',
        'fade-in':      'fadeIn 0.2s ease-out forwards',
        'drift-a':      'driftA 26s ease-in-out infinite',
        'drift-b':      'driftB 32s ease-in-out infinite',
        'drift-c':      'driftC 22s ease-in-out infinite',
        'shimmer':      'shimmer 2.5s linear infinite',
      },
      keyframes: {
        glow: {
          '0%':   { boxShadow: '0 0 5px rgba(255,184,0,0.2)' },
          '100%': { boxShadow: '0 0 20px rgba(255,184,0,0.4), 0 0 40px rgba(255,184,0,0.1)' },
        },
        slideUp: {
          '0%':   { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)',   opacity: '1' },
        },
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        driftA: {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '50%':      { transform: 'translate(60px, 40px) scale(1.08)' },
        },
        driftB: {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '50%':      { transform: 'translate(-50px, 60px) scale(1.1)' },
        },
        driftC: {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '50%':      { transform: 'translate(40px, -50px) scale(1.06)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
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
