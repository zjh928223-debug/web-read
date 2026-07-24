const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');

const indexSource = read('index.html');
const appSource = read('src', 'App.vue');
const loaderSource = read('src', 'composables', 'youtube-workflow-loader.js');
const panelSource = read('src', 'components', 'YouTubeWorkflowPanel.vue');
const stylesSource = read('styles.css');
const playbackSource = read('src', 'composables', 'playback-module.js');
const controlsSource = read('src', 'composables', 'controls-module.js');
const keyboardSource = read('src', 'composables', 'keyboard-module.js');
const playbackRuntimeSource = read('src', 'composables', 'reader-playback-runtime.js');
const mediaSourcePath = path.join(repoRoot, 'src', 'composables', 'media-source-module.js');
const videoFloatPath = path.join(repoRoot, 'src', 'components', 'VideoPlayerFloat.vue');

assert.ok(fs.existsSync(mediaSourcePath), 'media source compatibility module should exist');
assert.ok(fs.existsSync(videoFloatPath), 'floating video player component should exist');

const mediaSource = fs.readFileSync(mediaSourcePath, 'utf8');
const videoFloatSource = fs.readFileSync(videoFloatPath, 'utf8');

assert.ok(indexSource.includes('src/composables/media-source-module.js'), 'index.html should load the media source module');
assert.ok(
  indexSource.indexOf('src/composables/media-source-module.js') < indexSource.indexOf('src/composables/playback-module.js'),
  'media source module should load before playback-module.js'
);
assert.ok(appSource.includes('VideoPlayerFloat'), 'App.vue should mount the floating video player');

assert.ok(mediaSource.includes('createActiveMediaProxy'), 'media module should provide an active media proxy');
assert.ok(mediaSource.includes('getActiveMediaElement'), 'media module should expose current audio/video element lookup');
assert.ok(mediaSource.includes('setVideoPreferred'), 'media module should own the video preference');
assert.ok(mediaSource.includes('loadJobMedia'), 'media module should accept workflow job media metadata');
assert.ok(mediaSource.includes('youtubeWorkflow.videoPreferred'), 'video preference should persist in localStorage');
assert.ok(mediaSource.includes('youtubeWorkflowVideoWindow'), 'video window geometry should persist in localStorage');

assert.ok(videoFloatSource.includes('<video'), 'floating component should render a video element');
assert.ok(videoFloatSource.includes('preload="metadata"'), 'video should preload metadata only');
assert.ok(videoFloatSource.includes('controls'), 'video should use native controls');
assert.ok(videoFloatSource.includes('startVideoDrag'), 'video window should drag from the title bar');
assert.ok(videoFloatSource.includes('startVideoResize'), 'video window should resize from a handle');
assert.ok(videoFloatSource.includes('minimizeVideo'), 'video window should support minimize without switching sources');
assert.ok(videoFloatSource.includes('closeVideo'), 'video window close should switch back to audio');

assert.ok(loaderSource.includes("client.fileUrl(jobId, 'video')"), 'workflow loader should use a service video URL instead of a blob');
assert.ok(loaderSource.includes('mediaSource.loadJobMedia'), 'workflow loader should register video availability at load time');
assert.ok(panelSource.includes('videoPreferred'), 'workflow panel should expose shared video preference state');
assert.ok(panelSource.includes('toggleVideoPreferred'), 'workflow panel should toggle video preference through the media module');
assert.ok(panelSource.includes('视频优先'), 'video preference should be visible beside material controls and in the panel');
assert.ok(panelSource.includes('window.__mediaSource'), 'workflow panel should use the shared media source module');

assert.ok(playbackSource.includes('createActiveMediaProxy'), 'playback module should seek/play the active media element');
assert.ok(controlsSource.includes('createActiveMediaProxy'), 'controls module sync loop should read the active media element');
assert.ok(keyboardSource.includes('createActiveMediaProxy'), 'keyboard play/pause should target the active media element');
assert.ok(playbackRuntimeSource.includes('getActiveMediaElement'), 'transcript/chunk interactions should resolve active media');

assert.ok(stylesSource.includes('.youtube-video-player'), 'styles should include the floating video player');
assert.ok(stylesSource.includes('.youtube-video-resize-handle'), 'styles should include the proportional resize handle');
assert.ok(stylesSource.includes('.youtube-video-player .youtube-video-resize-handle'), 'resize handle styling should outrank global button/glass styles');
assert.ok(stylesSource.includes('min-height: 0'), 'resize handle should not inherit large global button dimensions');
assert.ok(stylesSource.includes('#audio-player.video-media-active'), 'audio player should show inactive video-mode styling instead of disappearing');

console.log('video player module check passed');
