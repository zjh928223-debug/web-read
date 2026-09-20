import { createApp } from 'vue'
import SrsReviewPage from './features/srs-review/SrsReviewPage.vue'
import { createInMemoryVocabularyRepository, createVocabularyService } from './services/vocabulary/index.js'
import { createOptionalLocalDictionaryClient } from './dictionary/ecdict/browser/optional-local-dictionary-client.mjs'
import './styles/workflow-ui.css'
import './features/srs-review/srs-review.css'
import './features/learning-ui/learning-ui.css'

const SAMPLE_URL = '/src/features/srs-review/srs-review.sample.local.json'

document.documentElement.classList.add('srs-review-standalone-document')

async function loadLocalSample() {
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
  createApp(SrsReviewPage, {
    service,
    standalone: true,
    dictionaryClient: createOptionalLocalDictionaryClient(),
  }).mount('#srs-review-app')
}

mountStandaloneReview().catch((error) => {
  const root = document.getElementById('srs-review-app')
  if (!root) return
  root.innerHTML = `<main class="srs-review-fatal" role="alert">${escapeHtml(error && error.message)}</main>`
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
