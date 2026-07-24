const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const serviceRoot = path.join(repoRoot, 'tools', 'subtitle-workflow');

assert.ok(fs.existsSync(serviceRoot), 'Read-Web should vendor the SubtitleWorkflow service source under tools/subtitle-workflow');

const requiredFiles = [
  'README.md',
  'requirements-service.txt',
  'subtitle_workflow.py',
  'chunk_adapter.py',
  'language_service.py',
  path.join('youtube_workflow', 'core.py'),
  path.join('youtube_workflow', 'service.py'),
  path.join('youtube_workflow', 'history.py'),
  path.join('youtube_workflow', 'credentials.py'),
  path.join('tests', 'test_service_app.py'),
  path.join('tests', 'test_workflow_core.py'),
];

for (const file of requiredFiles) {
  assert.ok(fs.existsSync(path.join(serviceRoot, file)), `missing vendored service file: ${file}`);
}

for (const excluded of ['output', '.workflow_state', '.gemini_cache', '__pycache__']) {
  assert.equal(fs.existsSync(path.join(serviceRoot, excluded)), false, `generated service directory should not be vendored: ${excluded}`);
}

const coreSource = fs.readFileSync(path.join(serviceRoot, 'youtube_workflow', 'core.py'), 'utf8');
const serviceSource = fs.readFileSync(path.join(serviceRoot, 'youtube_workflow', 'service.py'), 'utf8');
const startupSource = fs.readFileSync(path.join(repoRoot, 'scripts', 'start-youtube-reader.ps1'), 'utf8');
const gitignoreSource = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');

assert.ok(coreSource.includes('E:\\\\ReadWebData\\\\SubtitleWorkflow'), 'service default data root should live on E: drive');
assert.ok(coreSource.includes('DEFAULT_OUTPUT_DIR = DEFAULT_DATA_ROOT / "output"'), 'service output should default outside the repo');
assert.ok(coreSource.includes('DEFAULT_STATE_DIR = DEFAULT_DATA_ROOT / ".workflow_state"'), 'service state should default outside the repo');
assert.ok(serviceSource.includes('"features"') && serviceSource.includes('"videoPlayback"'), 'health response should expose videoPlayback feature support');
assert.ok(serviceSource.includes('"http://127.0.0.1:5174"'), 'service CORS should allow the feature worktree dev server');
assert.ok(serviceSource.includes('"DELETE"'), 'service CORS should allow browser delete/cleanup requests');
assert.ok(serviceSource.includes('$owner.TopMost = $true') && serviceSource.includes('$dialog.ShowDialog($owner)'), 'manual video picker should open above the browser with an owner window');
assert.ok(serviceSource.includes('clear_failed_jobs'), 'service should expose failed queue cleanup support');
assert.ok(serviceSource.includes('bind_video_source'), 'service should expose video source binding support');
assert.ok(serviceSource.includes('video-probe-cache.json'), 'service should cache video probe results outside media folders');
assert.ok(startupSource.includes('tools\\subtitle-workflow'), 'startup script should launch the vendored service source');
assert.ok(startupSource.includes('E:\\ReadWebData\\SubtitleWorkflow'), 'startup script should pass/use the E: data directory');
assert.ok(gitignoreSource.includes('tools/subtitle-workflow/output/'), 'repo should ignore service output if a user overrides output under tools');
assert.ok(gitignoreSource.includes('tools/subtitle-workflow/.workflow_state/'), 'repo should ignore service state if a user overrides state under tools');

console.log('subtitle workflow source check passed');
