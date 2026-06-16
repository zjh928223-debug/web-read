(function (global) {
    'use strict';

    let buttonEl = null;
    let panelEl = null;
    let onChange = null;
    let fieldEls = null;
    let isOpen = false;

    const VIEWPORT_MARGIN = 12;
    const PANEL_OFFSET = 8;

    function init(options = {}) {
        buttonEl = options.buttonEl || buttonEl;
        panelEl = options.panelEl || panelEl;
        onChange = typeof options.onChange === 'function' ? options.onChange : onChange;

        if (!buttonEl || !panelEl) return api;

        if (panelEl.parentElement !== document.body) {
            document.body.appendChild(panelEl);
        }

        render();
        bind();
        refreshForm();
        close();
        return api;
    }

    function render() {
        panelEl.innerHTML = `
            <form class="annotation-api-settings-panel__form">
                <div class="annotation-api-settings-panel__header">
                    <strong>Annotation API Configs</strong>
                    <span>仅本地保存到当前浏览器</span>
                </div>
                <div class="annotation-api-settings-toolbar">
                    <label class="annotation-api-settings-field annotation-api-settings-field--compact">
                        <span>当前配置</span>
                        <select name="currentProfile"></select>
                    </label>
                    <div class="annotation-api-settings-toolbar__actions">
                        <button type="button" class="small-btn" data-role="create">新建</button>
                        <button type="button" class="small-btn" data-role="delete">删除</button>
                    </div>
                </div>
                <label class="annotation-api-settings-field">
                    <span>配置名称</span>
                    <input name="profileName" type="text" autocomplete="off" spellcheck="false" />
                </label>
                <label class="annotation-api-settings-field">
                    <span>平台</span>
                    <select name="platform"></select>
                </label>
                <label class="annotation-api-settings-field annotation-api-settings-field--api-key">
                    <span>API Key</span>
                    <div class="annotation-api-settings-secret">
                        <input name="apiKey" type="password" autocomplete="off" spellcheck="false" />
                        <button type="button" class="annotation-api-settings-secret__toggle">显示</button>
                    </div>
                </label>
                <label class="annotation-api-settings-field">
                    <span>Model</span>
                    <input name="model" type="text" autocomplete="off" spellcheck="false" />
                </label>
                <details class="annotation-api-settings-advanced" data-role="advanced">
                    <summary>高级设置</summary>
                    <div class="annotation-api-settings-advanced__body">
                        <label class="annotation-api-settings-field">
                            <span>Base URL</span>
                            <input name="baseUrl" type="text" autocomplete="off" spellcheck="false" />
                        </label>
                        <div class="annotation-api-settings-advanced__hint" data-role="baseUrlHint"></div>
                    </div>
                </details>
                <div class="annotation-api-settings-panel__actions">
                    <button type="submit" class="small-btn" data-role="save">保存</button>
                </div>
                <div class="annotation-api-settings-panel__hint" data-role="hint" role="status" aria-live="polite"></div>
            </form>
        `;

        fieldEls = {
            form: panelEl.querySelector('form'),
            currentProfile: panelEl.querySelector('[name="currentProfile"]'),
            profileName: panelEl.querySelector('[name="profileName"]'),
            platform: panelEl.querySelector('[name="platform"]'),
            apiKey: panelEl.querySelector('[name="apiKey"]'),
            model: panelEl.querySelector('[name="model"]'),
            baseUrl: panelEl.querySelector('[name="baseUrl"]'),
            advanced: panelEl.querySelector('[data-role="advanced"]'),
            baseUrlHint: panelEl.querySelector('[data-role="baseUrlHint"]'),
            createBtn: panelEl.querySelector('[data-role="create"]'),
            deleteBtn: panelEl.querySelector('[data-role="delete"]'),
            hint: panelEl.querySelector('[data-role="hint"]'),
            secretToggle: panelEl.querySelector('.annotation-api-settings-secret__toggle')
        };
    }

    function bind() {
        if (buttonEl.dataset.annotationApiSettingsBound !== '1') {
            buttonEl.dataset.annotationApiSettingsBound = '1';
            buttonEl.addEventListener('click', handleToggleClick);
        }

        if (panelEl.dataset.annotationApiSettingsBound !== '1') {
            panelEl.dataset.annotationApiSettingsBound = '1';
            fieldEls.form.addEventListener('submit', handleSave);
            fieldEls.createBtn.addEventListener('click', handleCreateProfile);
            fieldEls.deleteBtn.addEventListener('click', handleDeleteProfile);
            fieldEls.currentProfile.addEventListener('change', handleSelectProfile);
            fieldEls.platform.addEventListener('change', handlePlatformChange);
            fieldEls.baseUrl.addEventListener('input', handleBaseUrlInput);
            fieldEls.secretToggle.addEventListener('click', toggleApiKeyVisibility);
            document.addEventListener('pointerdown', handleDocumentPointerDown, true);
            document.addEventListener('keydown', handleDocumentKeyDown);
            window.addEventListener('resize', handleViewportChange);
            window.addEventListener('scroll', handleViewportChange, true);
        }
    }

    function handleToggleClick(event) {
        event.preventDefault();
        if (isOpen) {
            close();
            return;
        }
        refreshForm();
        open();
    }

    function handleSave(event) {
        event.preventDefault();
        const configApi = global.AnnotationApiConfig;
        if (!configApi || typeof configApi.saveProfile !== 'function') return;
        const result = configApi.saveProfile(readFormData());
        refreshForm();
        setHint(buildSaveMessage(result), result.state === 'ready' ? 'success' : 'warning');
        positionPanel();
        notifyChange(result);
    }

    function handleCreateProfile() {
        const configApi = global.AnnotationApiConfig;
        if (!configApi || typeof configApi.createProfile !== 'function') return;
        const created = configApi.createProfile();
        refreshForm();
        fieldEls.profileName.focus();
        fieldEls.profileName.select();
        setHint('已新建一套本地配置。', 'neutral');
        positionPanel();
        notifyChange(created.result);
    }

    function handleDeleteProfile() {
        const configApi = global.AnnotationApiConfig;
        if (!configApi || typeof configApi.deleteCurrentProfile !== 'function') return;
        const result = configApi.deleteCurrentProfile();
        refreshForm();
        setHint('已删除当前配置。', 'warning');
        positionPanel();
        notifyChange(result);
    }

    function handleSelectProfile() {
        const configApi = global.AnnotationApiConfig;
        if (!configApi || typeof configApi.selectProfile !== 'function') return;
        const result = configApi.selectProfile(fieldEls.currentProfile.value);
        refreshForm();
        setHint(buildCurrentStateMessage(result), result.state === 'ready' ? 'success' : 'warning');
        positionPanel();
        notifyChange(result);
    }

    function handlePlatformChange() {
        const configApi = global.AnnotationApiConfig;
        const platform = fieldEls.platform.value;
        const defaultBaseUrl = configApi && typeof configApi.getDefaultBaseUrl === 'function'
            ? configApi.getDefaultBaseUrl(platform)
            : '';
        const isCustom = fieldEls.baseUrl.dataset.custom === 'true';
        if (!isCustom) {
            fieldEls.baseUrl.value = defaultBaseUrl;
        }
        updateBaseUrlPresentation();
    }

    function handleBaseUrlInput() {
        const configApi = global.AnnotationApiConfig;
        const platform = fieldEls.platform.value;
        const defaultBaseUrl = configApi && typeof configApi.getDefaultBaseUrl === 'function'
            ? configApi.getDefaultBaseUrl(platform)
            : '';
        const current = normalizeText(fieldEls.baseUrl.value);
        fieldEls.baseUrl.dataset.custom = current && current !== defaultBaseUrl ? 'true' : 'false';
        updateBaseUrlPresentation();
    }

    function toggleApiKeyVisibility() {
        if (!fieldEls || !fieldEls.apiKey) return;
        const isHidden = fieldEls.apiKey.type === 'password';
        fieldEls.apiKey.type = isHidden ? 'text' : 'password';
        fieldEls.secretToggle.textContent = isHidden ? '隐藏' : '显示';
    }

    function handleDocumentPointerDown(event) {
        if (!isOpen) return;
        const target = event.target;
        if ((panelEl && panelEl.contains(target)) || (buttonEl && buttonEl.contains(target))) return;
        close();
    }

    function handleDocumentKeyDown(event) {
        if (!isOpen) return;
        if (event.key === 'Escape') {
            close();
            buttonEl?.focus();
        }
    }

    function handleViewportChange() {
        if (!isOpen) return;
        global.requestAnimationFrame(positionPanel);
    }

    function refreshForm() {
        const configApi = global.AnnotationApiConfig;
        const state = configApi && typeof configApi.getEditorState === 'function'
            ? configApi.getEditorState()
            : {
                profiles: [],
                currentProfileId: '',
                currentProfile: buildEmptyEditableProfile(),
                supportedPlatforms: [{ id: 'gemini', label: 'Gemini', enabled: true }]
            };

        renderProfileOptions(state.profiles, state.currentProfileId);
        renderPlatformOptions(state.supportedPlatforms, (state.currentProfile && state.currentProfile.platform) || 'gemini');

        const profile = state.currentProfile || buildEmptyEditableProfile();

        fieldEls.profileName.value = profile.name || '';
        fieldEls.platform.value = profile.platform || 'gemini';
        fieldEls.apiKey.value = profile.apiKey || '';
        fieldEls.model.value = profile.model || '';
        fieldEls.baseUrl.value = profile.baseUrl || '';
        fieldEls.baseUrl.dataset.custom = profile.useCustomBaseUrl ? 'true' : 'false';
        fieldEls.apiKey.type = 'password';
        fieldEls.secretToggle.textContent = '显示';
        fieldEls.deleteBtn.disabled = !state.currentProfileId;
        fieldEls.currentProfile.disabled = state.profiles.length === 0;
        fieldEls.advanced.open = !!profile.useCustomBaseUrl;
        updateBaseUrlPresentation();
        setHint(buildCurrentStateMessage(configApi && typeof configApi.read === 'function' ? configApi.read() : null), 'neutral');
    }

    function renderProfileOptions(profiles, currentProfileId) {
        const options = ['<option value="">未选择</option>'];
        (profiles || []).forEach((profile) => {
            const selected = profile.id === currentProfileId ? ' selected' : '';
            options.push(`<option value="${escapeHtml(profile.id)}"${selected}>${escapeHtml(profile.name)}</option>`);
        });
        fieldEls.currentProfile.innerHTML = options.join('');
        fieldEls.currentProfile.value = currentProfileId || '';
    }

    function renderPlatformOptions(platforms, currentPlatform) {
        const options = (platforms || []).map((platform) => {
            const selected = platform.id === currentPlatform ? ' selected' : '';
            const disabled = platform.enabled ? '' : ' disabled';
            const label = platform.enabled ? platform.label : `${platform.label}（未接入）`;
            return `<option value="${escapeHtml(platform.id)}"${selected}${disabled}>${escapeHtml(label)}</option>`;
        });
        fieldEls.platform.innerHTML = options.join('');
        fieldEls.platform.value = currentPlatform || 'gemini';
    }

    function readFormData() {
        const configApi = global.AnnotationApiConfig;
        const platform = fieldEls.platform.value;
        const currentBaseUrl = normalizeText(fieldEls.baseUrl.value);
        const defaultBaseUrl = configApi && typeof configApi.getDefaultBaseUrl === 'function'
            ? configApi.getDefaultBaseUrl(platform)
            : currentBaseUrl;
        const useCustomBaseUrl = !!currentBaseUrl && currentBaseUrl !== defaultBaseUrl;

        return {
            id: fieldEls.currentProfile.value,
            name: fieldEls.profileName.value,
            platform,
            apiKey: fieldEls.apiKey.value,
            model: fieldEls.model.value,
            baseUrl: currentBaseUrl || defaultBaseUrl,
            useCustomBaseUrl
        };
    }

    function buildSaveMessage(result) {
        if (!result) return '配置已保存。';
        if (result.state === 'ready') return '已保存当前配置，当前页面无需刷新即可使用。';
        return '已保存当前配置，但当前选中平台或字段仍不可运行，生成入口会显示未配置。';
    }

    function buildCurrentStateMessage(result) {
        if (!result) return '当前未加载 Annotation API 配置。';
        if (result.state === 'ready') return '当前选中配置已生效。';
        if (result.state === 'mock') return '当前运行配置来自 mock 模式。';
        return '当前选中配置未完成或平台未接入，生成入口会显示未配置。';
    }

    function updateBaseUrlPresentation() {
        const configApi = global.AnnotationApiConfig;
        const platform = fieldEls.platform.value;
        const defaultBaseUrl = configApi && typeof configApi.getDefaultBaseUrl === 'function'
            ? configApi.getDefaultBaseUrl(platform)
            : '';
        const isCustom = fieldEls.baseUrl.dataset.custom === 'true';
        if (fieldEls.baseUrlHint) {
            fieldEls.baseUrlHint.textContent = isCustom
                ? `当前使用自定义 Base URL。默认值：${defaultBaseUrl}`
                : `当前跟随 ${getPlatformLabel(platform)} 默认 Base URL：${defaultBaseUrl}`;
        }
    }

    function getPlatformLabel(platformId) {
        const configApi = global.AnnotationApiConfig;
        if (!configApi || typeof configApi.getSupportedPlatforms !== 'function') return platformId;
        const match = configApi.getSupportedPlatforms().find((item) => item.id === platformId);
        return match ? match.label : platformId;
    }

    function setHint(message, tone = 'neutral') {
        if (!fieldEls || !fieldEls.hint) return;
        fieldEls.hint.textContent = String(message || '');
        fieldEls.hint.dataset.tone = tone;
    }

    function notifyChange(result) {
        if (typeof onChange === 'function') onChange(result);
    }

    function open() {
        isOpen = true;
        panelEl.hidden = false;
        panelEl.dataset.open = 'true';
        buttonEl?.setAttribute('aria-expanded', 'true');
        global.requestAnimationFrame(() => global.requestAnimationFrame(positionPanel));
    }

    function close() {
        isOpen = false;
        panelEl.hidden = true;
        panelEl.dataset.open = 'false';
        buttonEl?.setAttribute('aria-expanded', 'false');
    }

    function positionPanel() {
        if (!isOpen || !buttonEl || !panelEl || panelEl.hidden) return;

        const viewportWidth = global.innerWidth || document.documentElement.clientWidth || 0;
        const viewportHeight = global.innerHeight || document.documentElement.clientHeight || 0;
        const buttonRect = buttonEl.getBoundingClientRect();

        panelEl.style.maxWidth = `${Math.max(260, viewportWidth - VIEWPORT_MARGIN * 2)}px`;
        panelEl.style.maxHeight = `${Math.max(220, viewportHeight - VIEWPORT_MARGIN * 2)}px`;
        panelEl.style.left = `${VIEWPORT_MARGIN}px`;
        panelEl.style.top = `${VIEWPORT_MARGIN}px`;

        const panelRect = panelEl.getBoundingClientRect();
        const panelWidth = panelRect.width || panelEl.offsetWidth || 0;
        const panelHeight = panelRect.height || panelEl.offsetHeight || 0;

        let left = buttonRect.right - panelWidth;
        let top = buttonRect.bottom + PANEL_OFFSET;

        if (top + panelHeight > viewportHeight - VIEWPORT_MARGIN) {
            top = buttonRect.top - panelHeight - PANEL_OFFSET;
        }

        left = clamp(left, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewportWidth - panelWidth - VIEWPORT_MARGIN));
        top = clamp(top, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewportHeight - panelHeight - VIEWPORT_MARGIN));

        panelEl.style.left = `${Math.round(left)}px`;
        panelEl.style.top = `${Math.round(top)}px`;
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function buildEmptyEditableProfile() {
        return {
            id: '',
            name: '',
            platform: 'gemini',
            apiKey: '',
            model: '',
            baseUrl: '',
            useCustomBaseUrl: false
        };
    }

    function normalizeText(value) {
        return String(value || '').trim().replace(/\s+/g, ' ');
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[char]));
    }

    const api = {
        init,
        open,
        close,
        refreshForm
    };

    global.AnnotationApiSettingsUI = api;
})(window);

export function getAnnotationApiSettingsUiApi() {
    return window.AnnotationApiSettingsUI || null;
}

export default window.AnnotationApiSettingsUI;
