/** @type {import('tailwindcss').Config} */
const ramp = (name) =>
  Object.fromEntries(
    [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((s) => [
      s,
      `rgb(var(--c-${name}-${s}) / <alpha-value>)`,
    ]),
  );

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: ramp('primary'),
        secondary: ramp('secondary'),
        accent: ramp('accent'),
        success: ramp('success'),
        warning: ramp('warning'),
        error: ramp('error'),
        neutral: ramp('neutral'),
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          raised: 'rgb(var(--surface-raised) / <alpha-value>)',
          sunken: 'rgb(var(--surface-sunken) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          muted: 'rgb(var(--ink-muted) / <alpha-value>)',
          inverse: 'rgb(var(--ink-inverse) / <alpha-value>)',
        },
        line: 'rgb(var(--line) / <alpha-value>)',
        // Readable status/brand text: light tones on the public theme, dark tones on the admin system.
        fg: Object.fromEntries(
          ['brand', 'info', 'accent', 'success', 'warning', 'error'].map((t) => [t, `rgb(var(--fg-${t}) / <alpha-value>)`]),
        ),
        'on-primary': 'rgb(var(--on-primary) / <alpha-value>)',
        'on-secondary': 'rgb(var(--on-secondary) / <alpha-value>)',
        'on-accent': 'rgb(var(--on-accent) / <alpha-value>)',
      },
      fontFamily: {
        display: ['var(--font-display)'],
        body: ['var(--font-body)'],
      },
      borderRadius: {
        theme: 'var(--radius)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        twinkle: {
          '0%, 100%': { opacity: '0.35' },
          '50%': { opacity: '1' },
        },
        'spin-slow': {
          to: { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.4s ease-out both',
        twinkle: 'twinkle 4s ease-in-out infinite',
        'spin-slow': 'spin-slow 40s linear infinite',
      },
    },
  },
  plugins: [],
};
