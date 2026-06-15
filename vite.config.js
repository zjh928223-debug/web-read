import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const legacyScripts = [
  'chunk-note-layout-helpers.js',
  'chunk-note-layout-core.js',
  'annotation-bubble.js',
  'annotation-api-settings-ui.js'
]

function copyLegacyScripts() {
  return {
    name: 'copy-legacy-root-scripts',
    closeBundle() {
      for (const file of legacyScripts) {
        const from = resolve(file)
        const to = resolve('dist', file)
        mkdirSync(dirname(to), { recursive: true })
        copyFileSync(from, to)
      }
    }
  }
}

export default defineConfig({
  plugins: [vue(), copyLegacyScripts()],
  server: {
    host: '127.0.0.1',
    open: false,
    port: 5173
  }
})
