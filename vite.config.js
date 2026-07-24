import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [vue()],
  build: {
    rollupOptions: {
      input: {
        reader: resolve(__dirname, 'index.html'),
        srsReview: resolve(__dirname, 'srs-review.html')
      }
    }
  },
  server: {
    host: '127.0.0.1',
    open: false,
    port: 5173
  }
})
