import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
const root = 'E:/ReadWebDaily/N5-20261007'
const marker = 'C:/Users/0/AppData/Local/Temp/reader-dual-runtime-20261007/durable-data-path-rebinding.json'
if (existsSync(marker)) throw new Error('One-time relocation already completed; never rewrite live daily data')
const config = JSON.parse(readFileSync(path.join(root, 'daily-deployment.json')))
const result = spawnSync(config.python, [path.join(root, 'scripts/relocate-frozen-daily-data.py')], {
  stdio: 'inherit', windowsHide: true, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1