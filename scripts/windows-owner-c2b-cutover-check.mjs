import { spawn } from 'node:child_process'
import { once } from 'node:events'

const child = spawn(process.execPath, ['scripts/windows-owner-c2-cutover-check.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, READ_WEB_OWNER_C2_DOMAINS: 'passage-preview,annotation' },
  stdio: 'inherit',
  windowsHide: true,
})

child.once('error', (error) => {
  console.error(error)
})

const [code, signal] = await once(child, 'exit')
if (signal) {
  console.error(`C2b cutover journey stopped by ${signal}`)
  process.exitCode = 1
} else {
  process.exitCode = code ?? 1
}
