import { build } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'

// Build only this prototype; never load the product Vite configuration or dist.
const root = dirname(fileURLToPath(import.meta.url))
const result = await build({
  configFile: false,
  root,
  base: './',
  plugins: [tailwindcss()],
  build: {
    write: false,
    cssCodeSplit: false,
    rollupOptions: { input: join(root, 'index.html') },
  },
})
const output = result.output
let html = String(output.find(item => item.fileName === 'index.html').source)
html = html.replace(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g, (_, src) => {
  const chunk = output.find(item => item.fileName === src.replace(/^\.\//, ''))
  if (!chunk?.code) throw new Error(`Missing script asset: ${src}`)
  return `<script>${chunk.code.replace(/<\/script/gi, '<\\/script')}</script>`
})
html = html.replace(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g, (_, href) => {
  const asset = output.find(item => item.fileName === href.replace(/^\.\//, ''))
  if (!asset?.source) throw new Error(`Missing stylesheet asset: ${href}`)
  return `<style>${asset.source}</style>`
})
// The standalone script must run after the document, unlike the source module.
const script = html.match(/<script>[\s\S]*?<\/script>/)?.[0]
if (!script) throw new Error('No bundled preview script found')
html = html.replace(script, '').replace('</body>', `${script}\n</body>`)
await writeFile(join(root, 'preview.html'), html, 'utf8')
console.log(`Standalone preview: ${join(root, 'preview.html')}`)
