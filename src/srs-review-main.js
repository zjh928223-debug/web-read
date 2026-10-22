import { createApp } from 'vue'
import SrsReviewPage from './features/srs-review/SrsReviewPage.vue'
import bundledSample from './features/srs-review/srs-review.sample.local.json'
import { createInMemoryVocabularyRepository, createVocabularyService } from './services/vocabulary/index.js'
import { createOptionalLocalDictionaryClient } from './dictionary/ecdict/browser/optional-local-dictionary-client.mjs'
import './styles/workflow-ui.css'
import './features/srs-review/srs-review.css'
import './features/learning-ui/learning-ui.css'

const SAMPLE_URL = '/src/features/srs-review/srs-review.sample.local.json'

document.documentElement.classList.add('srs-review-standalone-document')

async function loadLocalSample() {
  if (bundledSample && typeof bundledSample === 'object') return bundledSample
  const response = await fetch(SAMPLE_URL, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error('未找到本地词库样本，请先导出 srs-review.sample.local.json')
  }
  return response.json()
}

async function mountStandaloneReview() {
  const sample = await loadLocalSample()
  const repository = createInMemoryVocabularyRepository(sample)
  const service = createVocabularyService({ repository })
  document.title = '复习样本演示（不写正式学习记录）'
  createApp(SrsReviewPage, {
    service,
    standalone: true,
    standaloneTitle: '复习样本演示（不写正式学习记录）',
    standaloneNotice: '样本演示：仅用于界面与交互演示，不写入正式词汇/SRS。',
    dictionaryClient: createOptionalLocalDictionaryClient(),
  }).mount('#srs-review-app')
}

mountStandaloneReview().catch((error) => {
  const root = document.getElementById('srs-review-app')
  if (!root) return
  document.title = '复习样本演示不可用（不写正式学习记录）'
  root.innerHTML = `<main class="srs-review-fatal" role="alert"><h1>复习样本演示不可用</h1><p>本页仅为样本演示，不写入正式学习记录。</p><p>${escapeHtml(error && error.message)}</p></main>`
})

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character])
}
