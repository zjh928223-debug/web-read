export const PERSONALIZATION_SHADOW_SETTINGS_KEY = 'read-web.personalization-shadow.settings.v1';
export const PERSONALIZATION_SHADOW_SETTINGS_SCHEMA = 'personalization-shadow-settings.v1';

function defaultSettings() {
  return {
    schema_version: PERSONALIZATION_SHADOW_SETTINGS_SCHEMA,
    enabled: false,
  };
}

function normalizeSettings(value) {
  if (!value
    || typeof value !== 'object'
    || Array.isArray(value)
    || value.schema_version !== PERSONALIZATION_SHADOW_SETTINGS_SCHEMA
    || typeof value.enabled !== 'boolean') {
    return defaultSettings();
  }
  return {
    schema_version: PERSONALIZATION_SHADOW_SETTINGS_SCHEMA,
    enabled: value.enabled,
  };
}

export function createPersonalizationShadowSettings(options = {}) {
  let storage = options.storage;
  if (storage === undefined) {
    try {
      storage = globalThis.localStorage;
    } catch {
      storage = null;
    }
  }
  let memory = defaultSettings();

  function load() {
    try {
      const raw = storage?.getItem?.(PERSONALIZATION_SHADOW_SETTINGS_KEY);
      memory = raw == null ? defaultSettings() : normalizeSettings(JSON.parse(raw));
    } catch {
      // Privacy modes and disabled storage must not block review.
      memory = defaultSettings();
    }
    return { ...memory };
  }

  function save(value) {
    memory = normalizeSettings(value);
    try {
      storage?.setItem?.(PERSONALIZATION_SHADOW_SETTINGS_KEY, JSON.stringify(memory));
    } catch {
      // Keep the setting for this page lifetime when persistent storage is unavailable.
    }
    return { ...memory };
  }

  return {
    load,
    isEnabled() {
      return load().enabled;
    },
    setEnabled(enabled) {
      if (typeof enabled !== 'boolean') {
        throw new TypeError('Shadow enabled state must be a boolean');
      }
      return save({
        schema_version: PERSONALIZATION_SHADOW_SETTINGS_SCHEMA,
        enabled,
      });
    },
  };
}
