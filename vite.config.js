import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createEcdictVitePlugin } from './src/dictionary/ecdict/api/ecdict-vite-plugin.mjs'
import { createAriaEdgeTtsVitePlugin } from './src/services/pronunciation/aria-edge-tts-vite-plugin.mjs'
import { createTatoebaSentenceVitePlugin } from './src/services/vocabulary/tatoeba-sentence-vite-plugin.mjs'
import { createWordnikSentenceVitePlugin } from './src/services/vocabulary/wordnik-sentence-vite-plugin.mjs'
import { createLocalSentenceVitePlugin } from './src/dictionary/local-sentences/local-sentence-vite-plugin.mjs'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const ecdictEnabled = process.env.ECDICT_ENABLED === 'true'
  const ecdictServiceUrl = pathToFileURL(resolve(
    __dirname,
    'src/dictionary/ecdict/application/ecdict-service.mjs'
  )).href
  return {
  plugins: [
    vue(),
    createAriaEdgeTtsVitePlugin(),
    createLocalSentenceVitePlugin({
      databasePath: process.env.LOCAL_SENTENCE_DATABASE_PATH,
    }),
    createTatoebaSentenceVitePlugin(),
    createWordnikSentenceVitePlugin({
      apiKey: process.env.WORDNIK_API_KEY || env.WORDNIK_API_KEY,
    }),
    createEcdictVitePlugin({
      enabled: ecdictEnabled,
      databasePath: process.env.ECDICT_DATABASE_PATH,
      serviceLoader: () => import(ecdictServiceUrl)
    })
  ],
  define: {
    __ECDICT_ENABLED__: JSON.stringify(ecdictEnabled)
  },
  build: {
    rollupOptions: {
      input: {
        reader: resolve(__dirname, 'index.html'),
        srsReview: resolve(__dirname, 'srs-review.html'),
        personalizationShadow: resolve(__dirname, 'personalization-shadow.html')
      }
    }
  },
  server: {
    host: '127.0.0.1',
    open: false,
    port: 5173
  }
  }
})
