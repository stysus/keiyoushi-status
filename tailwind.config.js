/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./web/**/*.{html,js}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      colors: {
        zinc: {
          850: '#1f1f23',
          925: '#111114',
          950: '#09090b',
        },
      },
    },
  },
  plugins: [],
};
