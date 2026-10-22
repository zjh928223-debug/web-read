import { createApp } from 'vue'
import PassagePreviewCheckPage from '../../src/features/passage-preview/PassagePreviewCheckPage.vue'
import './passage-preview-check.css'

export function mountPassagePreviewRatingLatencyHarness(target) {
  const items = [
    {
      item: {
        id: 'preview-latency:first',
        lemma: 'first',
        word: 'first',
        primaryMeaningZh: '第一',
        previewContext: { sentence: 'The first word should advance immediately.' },
      },
    },
    {
      item: {
        id: 'preview-latency:second',
        lemma: 'second',
        word: 'second',
        primaryMeaningZh: '第二',
        previewContext: { sentence: 'The second word should already be visible.' },
      },
    },
  ]
  const coordinator = {
    async recordDelayedCheck() {
      window.__previewRatingSaveCount += 1
      return { graduated: false }
    },
  }
  return createApp(PassagePreviewCheckPage, { items, coordinator }).mount(target)
}
