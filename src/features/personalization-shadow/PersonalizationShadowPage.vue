<template>
  <main class="shadow-page">
    <header class="shadow-header">
      <div>
        <p class="shadow-eyebrow">PERSONALIZATION SHADOW</p>
        <h1>学习模型观察</h1>
        <p>只读分析，不会改变正式复习安排</p>
      </div>
      <div class="shadow-header-actions">
        <button type="button" class="shadow-button is-quiet" @click="goBack">返回复习</button>
        <button type="button" class="shadow-button" :disabled="loading" @click="loadAll">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </div>
    </header>

    <section class="shadow-status" :class="{ 'is-on': shadowEnabled }" aria-live="polite">
      <span class="shadow-status-dot" aria-hidden="true"></span>
      <div class="shadow-status-copy">
        <strong>Shadow 模式{{ shadowEnabled ? '已开启' : '已关闭' }}</strong>
        <p>{{ shadowEnabled ? '之后新建的 V2 复习会话会自动记录模型建议；正式队列仍由原有规则决定。' : '开启后，之后新建的 V2 复习会话才会自动生成诊断报告。' }}</p>
        <p v-if="currentStatus?.v2_session_available" class="shadow-session-state">
          已找到今天的 V2 复习会话，可以安全补建报告。
        </p>
        <p v-else-if="currentStatus" class="shadow-session-state is-warning">
          今天还没有 V2 复习会话。若“今日复习”走的是旧版数据，当前不能生成 Shadow 报告；系统不会用旧日志伪造结果。
        </p>
        <p v-if="actionMessage" class="shadow-action-message">{{ actionMessage }}</p>
      </div>
      <div class="shadow-status-actions">
        <button
          type="button"
          class="shadow-switch"
          role="switch"
          :aria-checked="shadowEnabled"
          :disabled="settingSaving"
          @click="toggleShadow"
        >
          <span aria-hidden="true"></span>
          {{ shadowEnabled ? '停止后续观察' : '开始模型观察' }}
        </button>
        <button
          type="button"
          class="shadow-button is-quiet"
          :disabled="rebuilding || !currentStatus?.v2_session_available"
          @click="rebuildCurrentReport"
        >
          {{ rebuilding ? '补建中…' : '补建今天报告' }}
        </button>
      </div>
    </section>

    <section v-if="error" class="shadow-state" role="alert">
      <h2>暂时无法读取诊断报告</h2>
      <p>{{ error }}</p>
      <button type="button" class="shadow-button" @click="loadAll">重试</button>
    </section>

    <section v-else-if="!loading && diagnostic.sessions.length === 0" class="shadow-state">
      <h2>还没有 Shadow 报告</h2>
      <p>开启模型观察后，新建一次 V2 今日复习会话；如果会话已经存在，也可以使用上方“补建今天报告”。</p>
    </section>

    <template v-else-if="currentSession">
      <section class="shadow-summary" aria-label="报告摘要">
        <div><strong>{{ diagnostic.summary.total }}</strong><span>最近报告</span></div>
        <div><strong>{{ diagnostic.summary.sameOrder }}</strong><span>顺序一致</span></div>
        <div><strong>{{ diagnostic.summary.changed }}</strong><span>出现调整</span></div>
        <div><strong>{{ diagnostic.summary.insufficient }}</strong><span>证据不足</span></div>
        <label>
          <span>观察会话</span>
          <select v-model="selectedSessionId" @change="selectDefaultUnit">
            <option v-for="session in diagnostic.sessions" :key="session.id" :value="session.id">
              {{ session.generatedAtLabel }} · {{ session.id }}
            </option>
          </select>
        </label>
      </section>

      <section v-if="currentSession.insufficient" class="shadow-notice">
        当前会话的有效反馈太少。模型保持保守，只展示“证据不足”，不会据此强行改变学习内容。
      </section>

      <section class="shadow-comparison">
        <div class="shadow-card shadow-queue-card">
          <div class="shadow-card-heading">
            <div><span class="shadow-step">01</span><h2>队列对照</h2></div>
            <p>点击任一单词查看调整理由</p>
          </div>
          <div class="shadow-queue-grid">
            <div class="shadow-queue-column">
              <h3>正式复习队列</h3>
              <p>实际使用，不受此模型影响</p>
              <button
                v-for="row in currentSession.officialRows"
                :key="`official-${row.id}`"
                type="button"
                class="shadow-unit"
                :class="{ 'is-selected': selectedUnitId === row.id, 'is-moved': row.moved }"
                @click="selectedUnitId = row.id"
              >
                <span>{{ row.position }}</span><strong>{{ row.label }}</strong>
                <small>{{ row.moved ? `模型第 ${row.otherPosition} 位` : '位置一致' }}</small>
              </button>
            </div>
            <svg class="shadow-connectors" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <line
                v-for="line in currentSession.connectors"
                :key="line.id"
                x1="0" x2="100"
                :y1="connectorY(line.from, currentSession.officialRows.length)"
                :y2="connectorY(line.to, currentSession.shadowRows.length)"
                :class="{ 'is-moved': line.moved, 'is-selected': line.id === selectedUnitId }"
              />
            </svg>
            <div class="shadow-queue-column">
              <h3>模型建议</h3>
              <p>只记录，不执行</p>
              <button
                v-for="row in currentSession.shadowRows"
                :key="`shadow-${row.id}`"
                type="button"
                class="shadow-unit"
                :class="{ 'is-selected': selectedUnitId === row.id, 'is-moved': row.moved }"
                @click="selectedUnitId = row.id"
              >
                <span>{{ row.position }}</span><strong>{{ row.label }}</strong>
                <small>{{ row.moved ? `正式第 ${row.otherPosition} 位` : '位置一致' }}</small>
              </button>
            </div>
          </div>
        </div>

        <aside class="shadow-card shadow-inspector" aria-live="polite">
          <div class="shadow-card-heading"><div><span class="shadow-step">02</span><h2>为什么这样建议</h2></div></div>
          <template v-if="selectedDecision">
            <div class="shadow-word-title">
              <h3>{{ selectedDecision.label }}</h3>
              <span>{{ selectedDecision.positionChange }}</span>
            </div>
            <div class="shadow-presentation-change">
              <span>{{ selectedDecision.presentationFrom }}</span>
              <b aria-hidden="true">→</b>
              <span>{{ selectedDecision.presentationTo }}</span>
            </div>
            <p class="shadow-inspector-label">模型理由</p>
            <ul>
              <li v-for="reason in selectedDecision.reasons" :key="reason">{{ reason }}</li>
              <li v-if="selectedDecision.reasons.length === 0">当前证据没有产生额外调整理由</li>
            </ul>
            <dl>
              <div><dt>覆盖薄弱项</dt><dd>{{ selectedDecision.coveredSkills.join('、') || '无' }}</dd></div>
              <div><dt>模型评分</dt><dd>{{ selectedDecision.score }}</dd></div>
              <div><dt>真实执行</dt><dd>仍使用正式队列</dd></div>
            </dl>
          </template>
        </aside>
      </section>

      <section class="shadow-evidence-grid">
        <div class="shadow-card">
          <div class="shadow-card-heading"><div><span class="shadow-step">03</span><h2>能力证据</h2></div><p>{{ currentSession.sourceEventCount }} 条源事件</p></div>
          <div v-if="currentSession.skillRows.length" class="shadow-table-wrap">
            <table>
              <thead><tr><th>学习维度</th><th>证据</th><th>当前估计</th><th>不确定度</th><th>模型态度</th></tr></thead>
              <tbody>
                <tr v-for="skill in currentSession.skillRows" :key="skill.id">
                  <td>{{ skill.label }}</td><td>{{ skill.evidenceCount }}</td><td>{{ skill.masteryLabel }}</td><td>{{ skill.uncertaintyLabel }}</td>
                  <td><span class="shadow-pill" :class="`is-${skill.state.tone}`">{{ skill.state.label }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="shadow-empty-evidence">暂时没有足够的能力证据。</p>
        </div>

        <div class="shadow-card">
          <div class="shadow-card-heading"><div><span class="shadow-step">04</span><h2>展示偏好</h2></div><p>只影响形式，不回避薄弱内容</p></div>
          <div v-if="currentSession.preferenceRows.length" class="shadow-preferences">
            <div v-for="preference in currentSession.preferenceRows" :key="preference.id" class="shadow-preference">
              <div><strong>{{ preference.label }}</strong><span>{{ preference.sampleCount }} 次有效观察 · {{ preference.state }}</span></div>
              <div class="shadow-preference-meter"><i :style="{ width: `${Math.max(8, preference.confidence * 100)}%` }"></i></div>
              <b :class="{ 'is-negative': preference.score < 0 }">{{ preference.scoreLabel }}</b>
            </div>
          </div>
          <p v-else class="shadow-empty-evidence">暂时没有足够的形式偏好证据。</p>
        </div>
      </section>

      <footer class="shadow-footer">
        <span>数据来源：本地 LearningEvent 与只读 Shadow 报告</span>
        <span>生成于 {{ currentSession.generatedAtLabel }}</span>
      </footer>
    </template>
  </main>
</template>

<script setup>
import { computed, nextTick, onMounted, ref } from 'vue';
import { buildPersonalizationShadowDiagnostics } from './personalization-shadow-view-model.js';

const props = defineProps({
  reportRepository: { type: Object, required: true },
  settingsService: { type: Object, required: true },
  controlService: { type: Object, required: true },
});

const reports = ref([]);
const loading = ref(true);
const error = ref('');
const shadowEnabled = ref(props.settingsService.isEnabled());
const currentStatus = ref(null);
const settingSaving = ref(false);
const rebuilding = ref(false);
const actionMessage = ref('');
const selectedSessionId = ref('');
const selectedUnitId = ref('');
const diagnostic = computed(() => buildPersonalizationShadowDiagnostics(reports.value));
const currentSession = computed(() => diagnostic.value.sessions.find(
  (session) => session.id === selectedSessionId.value,
) || diagnostic.value.sessions[0] || null);
const selectedDecision = computed(() => currentSession.value?.decisions[selectedUnitId.value] || null);

function selectDefaultUnit() {
  nextTick(() => {
    selectedUnitId.value = currentSession.value?.defaultSelectedId || '';
  });
}

async function loadReports() {
  loading.value = true;
  error.value = '';
  try {
    reports.value = await props.reportRepository.list({ limit: 50 });
    if (!reports.value.some((report) => report.session_id === selectedSessionId.value)) {
      selectedSessionId.value = reports.value[0]?.session_id || '';
    }
    selectDefaultUnit();
  } catch (cause) {
    reports.value = [];
    error.value = cause?.message || '未知读取错误';
  } finally {
    loading.value = false;
  }
}

async function loadStatus() {
  currentStatus.value = await props.controlService.getCurrentStatus();
}

async function loadAll() {
  loading.value = true;
  error.value = '';
  try {
    await Promise.all([loadReports(), loadStatus()]);
  } catch (cause) {
    error.value = cause?.message || '未知读取错误';
  } finally {
    loading.value = false;
  }
}

async function toggleShadow() {
  settingSaving.value = true;
  actionMessage.value = '';
  try {
    shadowEnabled.value = props.settingsService.setEnabled(!shadowEnabled.value).enabled;
    actionMessage.value = shadowEnabled.value
      ? '已开启。下一次新建 V2 复习会话时会自动生成报告。'
      : '已关闭。已有报告会保留，正式复习数据不受影响。';
  } finally {
    settingSaving.value = false;
  }
}

async function rebuildCurrentReport() {
  rebuilding.value = true;
  actionMessage.value = '';
  try {
    const result = await props.controlService.rebuildCurrentReport();
    if (result.status === 'no_v2_session') {
      actionMessage.value = '今天没有可补建的 V2 复习会话。';
      await loadStatus();
      return;
    }
    actionMessage.value = '今天的 Shadow 报告已补建；正式队列和复习状态没有改变。';
    await Promise.all([loadReports(), loadStatus()]);
  } catch (cause) {
    actionMessage.value = cause?.message || '补建报告失败';
  } finally {
    rebuilding.value = false;
  }
}

function connectorY(position, total) {
  return total > 0 ? ((position - 0.5) / total) * 100 : 0;
}

function goBack() {
  if (window.history.length > 1) window.history.back();
  else window.location.assign('/');
}

onMounted(loadAll);
</script>
