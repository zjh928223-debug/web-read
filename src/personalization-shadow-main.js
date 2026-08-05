import { createApp } from 'vue';
import PersonalizationShadowPage from './features/personalization-shadow/PersonalizationShadowPage.vue';
import { createPersonalizationShadowDemoReports } from './features/personalization-shadow/personalization-shadow-demo.js';
import './features/personalization-shadow/personalization-shadow.css';
import {
  createInMemoryPersonalizationShadowReportRepository,
  createIndexedDbPersonalizationShadowReportRepository,
} from './services/vocabulary/personalization/personalization-shadow-report-repository.js';

const params = new URLSearchParams(window.location.search);
const demoMode = params.get('demo') === '1';
const featureFlags = window.__READ_WEB_FEATURE_FLAGS__ || {};
const shadowEnabled = featureFlags.VOCABULARY_PERSONALIZATION_SHADOW_ENABLED === true
  || featureFlags.VOCABULARY_PERSONALIZATION_SHADOW_ENABLED === 'true';
const reportRepository = demoMode
  ? createInMemoryPersonalizationShadowReportRepository(createPersonalizationShadowDemoReports())
  : createIndexedDbPersonalizationShadowReportRepository();

createApp(PersonalizationShadowPage, { reportRepository, shadowEnabled }).mount('#app');

