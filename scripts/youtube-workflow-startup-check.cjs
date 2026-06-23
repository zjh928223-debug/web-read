const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const scriptPath = path.join(repoRoot, 'scripts', 'start-youtube-reader.ps1');
  const source = fs.readFileSync(scriptPath, 'utf8');

  assert.ok(source.includes('http://127.0.0.1:8765/api/health'), 'startup script should check service health');
  assert.ok(source.includes('youtube_workflow.service:app'), 'startup script should launch the FastAPI app');
  assert.ok(source.includes('npm run dev'), 'startup script should launch Vite dev server');
  assert.ok(source.includes('http://127.0.0.1:5173'), 'startup script should open the reader');
  assert.ok(source.includes('Test-HttpOk'), 'startup script should avoid duplicate launches by probing health');
  assert.ok(source.includes('-WindowStyle Hidden'), 'background service/dev server windows should be hidden');

  console.log('youtube workflow startup check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
