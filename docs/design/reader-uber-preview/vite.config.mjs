import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root,
  base: './',
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(root, '../../../src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 9413,
    strictPort: true,
  },
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: false,
  },
})
