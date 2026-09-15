import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { createEcdictVitePlugin } from './src/dictionary/ecdict/api/ecdict-vite-plugin.mjs'
import { createAriaEdgeTtsVitePlugin } from './src/services/pronunciation/aria-edge-tts-vite-plugin.mjs'
import { createTatoebaSentenceVitePlugin } from './src/services/vocabulary/tatoeba-sentence-vite-plugin.mjs'
import { createMerriamWebsterSentenceVitePlugin } from './src/services/vocabulary/merriam-webster-sentence-vite-plugin.mjs'
import { createWordnikSentenceVitePlugin } from './src/services/vocabulary/wordnik-sentence-vite-plugin.mjs'
import { createLocalSentenceVitePlugin } from './src/dictionary/local-sentences/local-sentence-vite-plugin.mjs'
import { createSentenceTranslationVitePlugin } from './src/services/vocabulary/sentence-translation-vite-plugin.mjs'
import { createAiPreviewSentenceVitePlugin } from './src/services/vocabulary/ai-preview-sentence-vite-plugin.mjs'
import { createIeltsLearningPoolVitePlugin } from './src/services/vocabulary/ielts-learning-pool-vite-plugin.mjs'
import { loadRuntimeConfig } from './src/services/runtime/runtime-config-node.mjs'

const projectRoot = dirname(fileURLToPath(import.meta.url))

export function loadViteRuntimeConfig({ env = process.env, cwd = process.cwd() } = {}) {
  const configPath = env.READ_WEB_RUNTIME_CONFIG
    || resolve(projectRoot, 'config/runtime.optimization.json')
  return loadRuntimeConfig({ configPath, env, cwd })
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const runtime = loadViteRuntimeConfig({
    env: { ...env, ...process.env },
    cwd: process.cwd(),
  })
  const ecdictEnabled = process.env.ECDICT_ENABLED === 'true'
  const ecdictServiceUrl = pathToFileURL(resolve(
    projectRoot,
    'src/dictionary/ecdict/application/ecdict-service.mjs'
  )).href
  return {
  plugins: [
    vue(),
    tailwindcss(),
    createAriaEdgeTtsVitePlugin(),
    createLocalSentenceVitePlugin({
      databasePath: process.env.LOCAL_SENTENCE_DATABASE_PATH,
    }),
    createSentenceTranslationVitePlugin({
      apiKey: process.env.VOCABULARY_TRANSLATION_API_KEY || env.VOCABULARY_TRANSLATION_API_KEY || process.env.GEMINI_API_KEY || env.GEMINI_API_KEY,
      models: [
        process.env.VOCABULARY_TRANSLATION_MODEL || env.VOCABULARY_TRANSLATION_MODEL || runtime.ai.model,
        ...(process.env.VOCABULARY_TRANSLATION_FALLBACK_MODELS
          || env.VOCABULARY_TRANSLATION_FALLBACK_MODELS
          || '').split(','),
      ],
      proxyUrl: process.env.VOCABULARY_TRANSLATION_PROXY_URL || env.VOCABULARY_TRANSLATION_PROXY_URL || runtime.network.proxyUrl,
    }),
    createAiPreviewSentenceVitePlugin({
      apiKey: process.env.VOCABULARY_AI_PREVIEW_API_KEY
        || env.VOCABULARY_AI_PREVIEW_API_KEY
        || process.env.VOCABULARY_TRANSLATION_API_KEY
        || env.VOCABULARY_TRANSLATION_API_KEY
        || process.env.GEMINI_API_KEY
        || env.GEMINI_API_KEY,
      models: [
        process.env.VOCABULARY_AI_PREVIEW_MODEL || env.VOCABULARY_AI_PREVIEW_MODEL || runtime.ai.model,
        ...(process.env.VOCABULARY_AI_PREVIEW_FALLBACK_MODELS
          || env.VOCABULARY_AI_PREVIEW_FALLBACK_MODELS
          || '').split(','),
      ],
      proxyUrl: process.env.VOCABULARY_AI_PREVIEW_PROXY_URL
        || env.VOCABULARY_AI_PREVIEW_PROXY_URL
        || process.env.VOCABULARY_TRANSLATION_PROXY_URL
        || env.VOCABULARY_TRANSLATION_PROXY_URL
        || runtime.network.proxyUrl,
    }),
    createMerriamWebsterSentenceVitePlugin({
      dictionaryApiKey: process.env.MERRIAM_WEBSTER_DICTIONARY_API_KEY || env.MERRIAM_WEBSTER_DICTIONARY_API_KEY,
      learnersApiKey: process.env.MERRIAM_WEBSTER_LEARNERS_API_KEY || env.MERRIAM_WEBSTER_LEARNERS_API_KEY,
    }),
    createTatoebaSentenceVitePlugin(),
    createWordnikSentenceVitePlugin({
      apiKey: process.env.WORDNIK_API_KEY || env.WORDNIK_API_KEY,
    }),
    createIeltsLearningPoolVitePlugin({
      candidatesPath: process.env.IELTS_READING_VOCABULARY_CANDIDATES_PATH
        || env.IELTS_READING_VOCABULARY_CANDIDATES_PATH,
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
        reader: resolve(projectRoot, 'index.html'),
        srsReview: resolve(projectRoot, 'srs-review.html')
      }
    }
  },
  resolve: {
    alias: {
      '@': resolve(projectRoot, 'src')
    }
  },
  server: {
    host: runtime.frontend.host,
    open: false,
    port: runtime.frontend.port,
    strictPort: true
  }
  }
})
