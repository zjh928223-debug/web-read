'use strict';

const STORAGE_KEY = 'annotationApiConfig';
const STORE_VERSION = 3;
const DEFAULT_MODEL = 'gemini-2.5-flash';
const PLATFORM_DEFAULTS = Object.freeze({
    gemini: Object.freeze({
        platform: 'gemini',
        provider: 'gemini',
        label: 'Gemini',
        defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        enabled: true
    })
});
const SUPPORTED_PLATFORM = 'gemini';
const SUPPORTED_PROVIDER = PLATFORM_DEFAULTS[SUPPORTED_PLATFORM].provider;
const DEFAULT_BASE_URL = PLATFORM_DEFAULTS[SUPPORTED_PLATFORM].defaultBaseUrl;

export { STORAGE_KEY, STORE_VERSION, DEFAULT_BASE_URL, DEFAULT_MODEL, SUPPORTED_PROVIDER, SUPPORTED_PLATFORM, PLATFORM_DEFAULTS };

export function getRawConfig() {
    const global = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
    const raw = global.__ANNOTATION_API_CONFIG__;
    return raw && typeof raw === 'object' ? normalizeRuntimeConfig(raw) : null;
}

export function getStoredConfig() {
    return loadProfileStore();
}

export function getMode() {
    const raw = getRawConfig();
    return raw ? raw.mode : '';
}

export function getConfigState() {
    return getValidatedConfig().state;
}

export function getValidatedConfig() {
    const result = read();
    if (result.state === 'mock') {
        return {
            state: 'configured',
            mode: 'mock',
            provider: 'mock',
            apiKey: '',
            model: 'mock',
            baseUrl: '',
            extraHeaders: {}
        };
    }

    if (result.state !== 'ready') {
        return {
            state: 'unconfigured',
            reason: result.reason,
            message: result.message
        };
    }

    return {
        state: 'configured',
        ...result.config
    };
}

export function read(override = null) {
    const raw = override && typeof override === 'object'
        ? normalizeRuntimeConfig(override)
        : getRawConfig();

    if (!raw) {
        return buildUnconfiguredResult('missing-config', 'annotation API config missing');
    }

    const mode = raw.mode;
    if (mode !== 'mock' && mode !== 'real') {
        return buildUnconfiguredResult('missing-mode', 'annotation API mode must be "mock" or "real"', raw);
    }

    if (mode === 'mock') {
        return {
            state: 'mock',
            config: {
                mode: 'mock',
                provider: 'mock',
                apiKey: '',
                model: 'mock',
                baseUrl: '',
                extraHeaders: {}
            },
            raw
        };
    }

    const platform = normalizePlatform(raw.platform || raw.provider);
    const platformMeta = getPlatformMeta(platform);
    const apiKey = readText(raw.apiKey);
    const model = readText(raw.model);
    const baseUrl = trimTrailingSlash(readText(raw.baseUrl) || getDefaultBaseUrl(platform));

    if (!platform) {
        return buildUnconfiguredResult('missing-platform', 'annotation API platform missing', raw);
    }

    if (!platformMeta) {
        return buildUnconfiguredResult('unsupported-platform', `annotation API platform "${platform}" is not supported`, raw);
    }

    if (!platformMeta.enabled) {
        return buildUnconfiguredResult('platform-not-enabled', `annotation API platform "${platform}" is not enabled`, raw);
    }

    if (!apiKey) {
        return buildUnconfiguredResult('missing-api-key', 'annotation API key missing', raw);
    }

    if (!model) {
        return buildUnconfiguredResult('missing-model', 'annotation API model missing', raw);
    }

    return {
        state: 'ready',
        config: {
            mode: 'real',
            provider: platformMeta.provider,
            apiKey,
            model,
            baseUrl,
            extraHeaders: {}
        },
        raw: {
            mode: 'real',
            platform,
            provider: platformMeta.provider,
            apiKey,
            model,
            baseUrl
        }
    };
}

export function getEditableConfig(source = null) {
    const profile = source && typeof source === 'object'
        ? normalizeProfile(source, 0)
        : getCurrentProfile(loadProfileStore());

    return buildEditableProfile(profile);
}

export function getEditorState() {
    const store = loadProfileStore();
    const currentProfile = getCurrentProfile(store);
    return {
        store,
        profiles: store.profiles.map((profile) => ({
            id: profile.id,
            name: profile.name
        })),
        currentProfileId: store.currentProfileId || '',
        currentProfile: buildEditableProfile(currentProfile),
        supportedPlatforms: getSupportedPlatforms()
    };
}

export function saveConfig(input) {
    return saveProfile(input);
}

export function clearConfig() {
    return clearAllProfiles();
}

export function restore() {
    const store = saveProfileStore(loadProfileStore());
    syncWindowConfigFromStore(store);
    return read();
}

export function saveProfile(input) {
    const store = loadProfileStore();
    const normalizedInput = normalizeProfileInput(input);
    const profileId = readText(normalizedInput.id || store.currentProfileId) || buildProfileId();

    const nextProfiles = store.profiles.slice();
    const existingIndex = nextProfiles.findIndex((profile) => profile.id === profileId);
    const nextProfile = normalizeProfile(
        { ...normalizedInput, id: profileId },
        existingIndex >= 0 ? existingIndex : nextProfiles.length
    );

    if (existingIndex >= 0) nextProfiles[existingIndex] = nextProfile;
    else nextProfiles.push(nextProfile);

    const nextStore = saveProfileStore({
        version: STORE_VERSION,
        currentProfileId: profileId,
        profiles: nextProfiles
    });

    syncWindowConfigFromStore(nextStore);
    return read();
}

export function createProfile(seed = {}) {
    const store = loadProfileStore();
    const platform = normalizePlatform(seed.platform || seed.provider) || SUPPORTED_PLATFORM;
    const profileId = buildProfileId();
    const profile = normalizeProfile({
        id: profileId,
        name: buildNextProfileName(store.profiles),
        platform,
        apiKey: '',
        model: DEFAULT_MODEL,
        baseUrl: getDefaultBaseUrl(platform),
        useCustomBaseUrl: false,
        ...seed
    }, store.profiles.length);

    const nextStore = saveProfileStore({
        version: STORE_VERSION,
        currentProfileId: profileId,
        profiles: [...store.profiles, profile]
    });
    syncWindowConfigFromStore(nextStore);
    return {
        store: nextStore,
        profile,
        result: read()
    };
}

export function selectProfile(profileId) {
    const store = loadProfileStore();
    const nextStore = saveProfileStore({
        ...store,
        currentProfileId: store.profiles.some((profile) => profile.id === profileId) ? profileId : ''
    });
    syncWindowConfigFromStore(nextStore);
    return read();
}

export function deleteCurrentProfile() {
    const store = loadProfileStore();
    if (!store.currentProfileId) {
        syncWindowConfigFromStore(store);
        return read();
    }

    const currentIndex = store.profiles.findIndex((profile) => profile.id === store.currentProfileId);
    const nextProfiles = store.profiles.filter((profile) => profile.id !== store.currentProfileId);
    let nextCurrentProfileId = '';
    if (nextProfiles.length) {
        const nextIndex = Math.min(currentIndex, nextProfiles.length - 1);
        nextCurrentProfileId = nextProfiles[nextIndex].id;
    }

    const nextStore = saveProfileStore({
        version: STORE_VERSION,
        currentProfileId: nextCurrentProfileId,
        profiles: nextProfiles
    });
    syncWindowConfigFromStore(nextStore);
    return read();
}

export function clearAllProfiles() {
    const nextStore = saveProfileStore({
        version: STORE_VERSION,
        currentProfileId: '',
        profiles: []
    });
    syncWindowConfigFromStore(nextStore);
    return read();
}

export function syncWindowConfig(rawConfig) {
    const global = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
    const normalized = normalizeRuntimeConfig(rawConfig);
    if (!normalized) {
        clearWindowConfig();
        return null;
    }
    global.__ANNOTATION_API_CONFIG__ = { ...normalized };
    return global.__ANNOTATION_API_CONFIG__;
}

export function syncWindowConfigFromStore(store) {
    const currentProfile = getCurrentProfile(store);
    if (!currentProfile) {
        clearWindowConfig();
        return null;
    }
    return syncWindowConfig(profileToRuntimeConfig(currentProfile));
}

export function getSupportedPlatforms() {
    return Object.values(PLATFORM_DEFAULTS).map((item) => ({
        id: item.platform,
        label: item.label,
        enabled: !!item.enabled
    }));
}

export function getPlatformMeta(platform) {
    const key = normalizePlatform(platform);
    return key ? PLATFORM_DEFAULTS[key] || null : null;
}

export function getDefaultBaseUrl(platform) {
    const meta = getPlatformMeta(platform) || PLATFORM_DEFAULTS[SUPPORTED_PLATFORM];
    return trimTrailingSlash(meta.defaultBaseUrl);
}

function loadProfileStore() {
    const parsed = readStoredProfileStore();
    return normalizeProfileStore(parsed);
}

function saveProfileStore(store) {
    const global = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
    const normalized = normalizeProfileStore(store);
    try {
        if (global.localStorage) {
            global.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
        }
    } catch (error) {}
    return normalized;
}

function readStoredProfileStore() {
    try {
        const global = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
        const raw = global.localStorage ? global.localStorage.getItem(STORAGE_KEY) : null;
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (error) {
        try {
            const global = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
            if (global.localStorage) global.localStorage.removeItem(STORAGE_KEY);
        } catch (storageError) {}
        return null;
    }
}

function normalizeProfileStore(rawStore) {
    if (!rawStore || typeof rawStore !== 'object') {
        return buildEmptyStore();
    }

    if (!Array.isArray(rawStore.profiles)) {
        const legacyConfig = normalizeRuntimeConfig(rawStore);
        if (!legacyConfig || legacyConfig.mode !== 'real') {
            return buildEmptyStore();
        }
        const migratedPlatform = normalizePlatform(legacyConfig.platform || legacyConfig.provider) || SUPPORTED_PLATFORM;
        const defaultBaseUrl = getDefaultBaseUrl(migratedPlatform);
        const migratedProfile = normalizeProfile({
            id: buildProfileId(),
            name: '默认配置',
            platform: migratedPlatform,
            apiKey: legacyConfig.apiKey,
            model: legacyConfig.model,
            baseUrl: legacyConfig.baseUrl,
            useCustomBaseUrl: trimTrailingSlash(legacyConfig.baseUrl) !== trimTrailingSlash(defaultBaseUrl)
        }, 0);
        return {
            version: STORE_VERSION,
            currentProfileId: migratedProfile.id,
            profiles: [migratedProfile]
        };
    }

    const profiles = rawStore.profiles
        .map((profile, index) => normalizeProfile(profile, index))
        .filter(Boolean);

    const currentProfileId = profiles.some((profile) => profile.id === rawStore.currentProfileId)
        ? rawStore.currentProfileId
        : (profiles[0] ? profiles[0].id : '');

    return {
        version: STORE_VERSION,
        currentProfileId,
        profiles
    };
}

function normalizeRuntimeConfig(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const hasRecognizedField = ['mode', 'platform', 'provider', 'apiKey', 'model', 'baseUrl'].some((key) => key in raw);
    if (!hasRecognizedField) return null;

    const mode = normalizeMode(raw.mode);
    const platform = normalizePlatform(raw.platform || raw.provider) || SUPPORTED_PLATFORM;
    const platformMeta = getPlatformMeta(platform) || getPlatformMeta(SUPPORTED_PLATFORM);
    const provider = platformMeta.provider;
    const apiKey = readText(raw.apiKey);
    const model = readText(raw.model);
    const baseUrl = trimTrailingSlash(readText(raw.baseUrl) || getDefaultBaseUrl(platform));

    return {
        mode,
        platform,
        provider,
        apiKey,
        model,
        baseUrl
    };
}

function normalizeProfileInput(raw) {
    const platform = normalizePlatform(raw && (raw.platform || raw.provider)) || SUPPORTED_PLATFORM;
    const defaultBaseUrl = getDefaultBaseUrl(platform);
    const rawBaseUrl = trimTrailingSlash(readText(raw && raw.baseUrl));
    const explicitCustom = raw && typeof raw.useCustomBaseUrl === 'boolean'
        ? raw.useCustomBaseUrl
        : null;
    const useCustomBaseUrl = explicitCustom != null
        ? explicitCustom
        : (!!rawBaseUrl && rawBaseUrl !== defaultBaseUrl);
    const baseUrl = useCustomBaseUrl
        ? (rawBaseUrl || defaultBaseUrl)
        : defaultBaseUrl;

    return {
        id: readText(raw && raw.id),
        name: readText(raw && raw.name),
        platform,
        apiKey: readText(raw && raw.apiKey),
        model: readText(raw && raw.model) || DEFAULT_MODEL,
        baseUrl,
        useCustomBaseUrl
    };
}

function normalizeProfile(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    const normalized = normalizeProfileInput(raw);
    return {
        id: normalized.id || `annotation-profile-${index + 1}`,
        name: normalized.name || `配置 ${index + 1}`,
        platform: normalized.platform || SUPPORTED_PLATFORM,
        apiKey: normalized.apiKey,
        model: normalized.model,
        baseUrl: normalized.baseUrl,
        useCustomBaseUrl: !!normalized.useCustomBaseUrl
    };
}

function buildEditableProfile(profile) {
    if (!profile || typeof profile !== 'object') {
        return {
            id: '',
            name: '',
            platform: SUPPORTED_PLATFORM,
            apiKey: '',
            model: DEFAULT_MODEL,
            baseUrl: getDefaultBaseUrl(SUPPORTED_PLATFORM),
            useCustomBaseUrl: false
        };
    }
    const normalized = normalizeProfile(profile, 0);
    return {
        id: readText(normalized && normalized.id),
        name: readText(normalized && normalized.name),
        platform: normalizePlatform(normalized && normalized.platform) || SUPPORTED_PLATFORM,
        apiKey: readText(normalized && normalized.apiKey),
        model: readText(normalized && normalized.model) || DEFAULT_MODEL,
        baseUrl: trimTrailingSlash(readText(normalized && normalized.baseUrl) || getDefaultBaseUrl(normalized && normalized.platform)),
        useCustomBaseUrl: !!(normalized && normalized.useCustomBaseUrl)
    };
}

function profileToRuntimeConfig(profile) {
    if (!profile) return null;
    const normalized = buildEditableProfile(profile);
    const platformMeta = getPlatformMeta(normalized.platform);
    if (!platformMeta || !platformMeta.enabled) return null;
    return {
        mode: 'real',
        platform: normalized.platform,
        provider: platformMeta.provider,
        apiKey: normalized.apiKey,
        model: normalized.model,
        baseUrl: normalized.baseUrl
    };
}

function getCurrentProfile(store) {
    if (!store || !Array.isArray(store.profiles) || !store.currentProfileId) return null;
    return store.profiles.find((profile) => profile.id === store.currentProfileId) || null;
}

function buildEmptyStore() {
    return {
        version: STORE_VERSION,
        currentProfileId: '',
        profiles: []
    };
}

function buildNextProfileName(profiles) {
    const used = new Set((profiles || []).map((profile) => readText(profile && profile.name)));
    let index = (profiles || []).length + 1;
    while (used.has(`配置 ${index}`)) index++;
    return `配置 ${index}`;
}

function buildProfileId() {
    const random = Math.random().toString(36).slice(2, 8);
    return `annotation-profile-${Date.now()}-${random}`;
}

function buildUnconfiguredResult(reason, message, raw = null) {
    return {
        state: 'unconfigured',
        reason,
        message,
        config: null,
        raw: raw || null
    };
}

function clearWindowConfig() {
    try {
        const global = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
        delete global.__ANNOTATION_API_CONFIG__;
    } catch (error) {
        const global = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
        global.__ANNOTATION_API_CONFIG__ = undefined;
    }
}

function normalizeMode(value) {
    const mode = readText(value).toLowerCase();
    return mode === 'mock' || mode === 'real' ? mode : '';
}

function normalizePlatform(value) {
    return readText(value).toLowerCase();
}

function readText(value) {
    return value == null ? '' : String(value).trim();
}

function trimTrailingSlash(value) {
    return String(value || '').replace(/\/+$/, '');
}
