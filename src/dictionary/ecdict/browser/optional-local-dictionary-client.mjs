import { createLocalDictionaryClient } from './local-dictionary-client.mjs';

function isDictionaryEnabled(explicitValue) {
  if (typeof explicitValue === 'boolean') return explicitValue;
  return typeof __ECDICT_ENABLED__ !== 'undefined' && __ECDICT_ENABLED__ === true;
}

export function createOptionalLocalDictionaryClient({
  enabled,
  clientFactory = createLocalDictionaryClient,
  clientOptions,
} = {}) {
  if (!isDictionaryEnabled(enabled)) return null;
  return clientFactory(clientOptions);
}
