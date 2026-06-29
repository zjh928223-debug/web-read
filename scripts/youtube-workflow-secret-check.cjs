const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return [full];
  });
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const sourceFiles = walk(path.join(repoRoot, 'src')).filter((file) => /\.(js|vue|css)$/.test(file));
  const geminiKeyPattern = /AIza[0-9A-Za-z_-]{20,}/;
  const findings = [];

  for (const file of sourceFiles) {
    const source = fs.readFileSync(file, 'utf8');
    if (geminiKeyPattern.test(source)) findings.push(`${file}: Gemini-like key literal`);
    if (source.includes('youtubeWorkflow.apiKey')) findings.push(`${file}: legacy browser API key storage key`);
  }

  assert.deepEqual(findings, []);
  console.log('youtube workflow secret check passed');
}

main();
