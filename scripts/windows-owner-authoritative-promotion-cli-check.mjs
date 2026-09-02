import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const filePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'windows-owner-authoritative-promotion.mjs')
const source = await readFile(filePath, 'utf8')

for (const token of [
  "['Plan', 'Inventory', 'DryRun', 'Apply', 'Resume', 'Rollback']",
  "'E:\\\\ReadWebData\\\\SubtitleWorkflow-Optimization'",
  "'E:\\\\ReadWebData\\\\SubtitleWorkflow-Next'",
  "const SOURCE_HOST_PORT = 5200",
  "const SOURCE_FRONT_DOOR_PORT = 5184",
  "const SOURCE_CAPABILITY_PORT = 8776",
  "const TARGET_HOST_PORT = 5174",
  "const TARGET_CAPABILITY_PORT = 8766",
  "'--confirm-owner-promotion'",
  "spawn('powershell.exe'",
  "execFileAsync('netstat.exe'",
  'OWNER_PROMOTION_PORT_OWNER_UNKNOWN',
  'createAuthoritativePromotionCoordinator',
  'createPromotionStateFileStore',
  'OWNER_PROMOTION_MEDIA_COPIED',
  'requestRange',
]) {
  if (!source.includes(token)) throw new Error(`CLI contract token is missing: ${token}`)
}

if (/playwright|chrome|browser/iu.test(source)) throw new Error('promotion CLI must not use browser automation')
if (source.includes('Stop-Process')) throw new Error('promotion CLI must not stop a process directly')
if (!source.includes("if (!options.confirm) throw promotionError('OWNER_PROMOTION_CONFIRMATION_REQUIRED')")) {
  throw new Error('mutating promotion commands must require explicit confirmation')
}
if (!source.includes("if (command === 'Plan')")) throw new Error('Plan command is missing')
if (!source.includes("write: false")) throw new Error('read-only command result contract is missing')

console.log('windows owner authoritative promotion CLI contract: passed')
