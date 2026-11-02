import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { apiPlugin } from './server/api.js'

const espnProxy = {
  '/espn': {
    target: 'https://site.api.espn.com',
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/espn/, '/apis/site/v2/sports'),
  },
}

export default defineConfig(({ mode }) => {
  // '' prefix loads ODDS_API_KEY / ANTHROPIC_API_KEY too; they are only used server-side.
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') }
  return {
    plugins: [vue(), apiPlugin(env)],
    server: { proxy: espnProxy },
    preview: { proxy: espnProxy },
  }
})
