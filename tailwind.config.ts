import type { Config } from 'tailwindcss'

export default {
  content: [
    './app.vue',
    './components/**/*.{vue,ts}',
    './layouts/**/*.vue',
    './pages/**/*.vue',
    './composables/**/*.{ts,vue}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config
