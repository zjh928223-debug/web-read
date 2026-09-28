import { build } from 'vite'
import config from './vite.config.mjs'

await build({ ...config, mode: 'production' })

console.log(`Built standalone preview at ${config.build.outDir}`)
