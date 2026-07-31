const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const sourcePath = path.join(repoRoot, 'src', 'utils', 'identity-storage-keys.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const encodedSource = Buffer.from('globalThis.window = globalThis.window || globalThis;\n' + source, 'utf8').toString('base64');
  const { buildAudioKey } = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);

  assert.equal(
    buildAudioKey({ source: 'youtube-workflow', jobId: 'job-stable', name: 'Example.audio', size: 10, lastModified: 111 }),
    'youtube-workflow::job-stable'
  );
  assert.equal(
    buildAudioKey({ source: 'youtube-workflow', jobId: 'job-stable', name: 'Example.audio', size: 10, lastModified: 999 }),
    'youtube-workflow::job-stable',
    'workflow audio key should not change every time the same job is reopened'
  );
  assert.equal(
    buildAudioKey({ name: 'Example.audio', size: 10, lastModified: 111 }),
    'Example.audio__10__111',
    'manual/imported audio should keep the existing file metadata key behavior'
  );

  console.log('identity storage keys check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
