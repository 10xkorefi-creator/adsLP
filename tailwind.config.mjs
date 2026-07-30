/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        navy: {
          950: '#0B132B',
          900: '#1C2541',
          800: '#2A365C',
        },
        tally: {
          50: '#ECFDF5',
          100: '#D1FAE5',
          500: '#10B981',
          600: '#059669',
          700: '#047857',
        }
      },
      boxShadow: {
        'glow-emerald': '0 10px 25px -5px rgba(5, 150, 105, 0.4)',
        'glow-purple': '0 10px 25px -5px rgba(124, 58, 237, 0.3)',
      }
    },
  },
  plugins: [],
}
