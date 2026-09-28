import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const previewRoot = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: previewRoot,
  plugins: [tailwindcss()],
  build: {
    outDir: resolve(previewRoot, 'dist'),
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 4318,
    strictPort: true,
  },
})
