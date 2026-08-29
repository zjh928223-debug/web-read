import { createApp } from 'vue';
import PersonalizationShadowPage from './features/personalization-shadow/PersonalizationShadowPage.vue';
import { createPersonalizationShadowDemoReports } from './features/personalization-shadow/personalization-shadow-demo.js';
import './features/personalization-shadow/personalization-shadow.css';
import {
  createInMemoryPersonalizationShadowReportRepository,
  createIndexedDbPersonalizationShadowReportRepository,
} from './services/vocabulary/personalization/personalization-shadow-report-repository.js';
import {
  createPersonalizationShadowService,
} from './services/vocabulary/personalization/personalization-shadow-service.js';
import {
  createPersonalizationShadowSettings,
} from './services/vocabulary/personalization/personalization-shadow-settings.js';
import {
  createPersonalizationShadowControlService,
} from './services/vocabulary/personalization/personalization-shadow-control-service.js';
import {
  createIndexedDbAcquisitionRepository,
} from './services/vocabulary/vocabulary-acquisition-repository.js';
import {
  createIndexedDbLearningEventRepository,
} from './services/vocabulary/vocabulary-learning-events.js';
import {
  createIndexedDbReviewSessionLedgerRepository,
} from './services/vocabulary/srs-review-session-ledger.js';
import { initializeWindowsOwnerDomainCutoverComposition } from './services/windows-owner-domain-cutover.js';
import { getWindowsOwnerVocabularySrsIntegration } from './services/vocabulary/windows-owner-vocabulary-srs.js';

await initializeWindowsOwnerDomainCutoverComposition({
  windowObject: window,
  documentObject: document,
  pollIntervalMs: 750,
});
const vocabularySrsIntegration = getWindowsOwnerVocabularySrsIntegration(window);

const params = new URLSearchParams(window.location.search);
const demoMode = params.get('demo') === '1';
const reportRepository = demoMode
  ? createInMemoryPersonalizationShadowReportRepository(createPersonalizationShadowDemoReports())
  : vocabularySrsIntegration?.personalizationShadowReportRepository
    || createIndexedDbPersonalizationShadowReportRepository();
const settingsService = createPersonalizationShadowSettings({
  storage: demoMode ? createMemoryStorage() : window.localStorage,
});
const controlService = demoMode
  ? createDemoControlService(reportRepository)
  : createPersonalizationShadowControlService({
    acquisitionRepository: vocabularySrsIntegration?.acquisitionRepository
      || createIndexedDbAcquisitionRepository(),
    learningEventRepository: vocabularySrsIntegration?.learningEventRepository
      || createIndexedDbLearningEventRepository(),
    sessionLedgerRepository: vocabularySrsIntegration?.sessionLedgerRepository
      || createIndexedDbReviewSessionLedgerRepository(),
    reportRepository,
    shadowRunner: createPersonalizationShadowService({ reportRepository }),
  });

createApp(PersonalizationShadowPage, {
  reportRepository,
  settingsService,
  controlService,
}).mount('#app');

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

function createDemoControlService(repository) {
  return {
    async getCurrentStatus() {
      const [report] = await repository.list({ limit: 1 });
      return {
        schema_version: 'personalization-shadow-control.v1',
        session_id: report?.session_id ?? 'demo-session-01',
        v2_session_available: true,
        report_available: Boolean(report),
        session_status: 'completed',
      };
    },
    async rebuildCurrentReport() {
      const [report] = await repository.list({ limit: 1 });
      return {
        status: 'rebuilt',
        session_id: report?.session_id ?? 'demo-session-01',
        report: report ?? null,
      };
    },
  };
}
