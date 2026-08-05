/**
 * Presentation candidates are intentionally data-shaped.  This module owns
 * the small amount of canonicalisation needed by the PL-C boundary without
 * making the feature axes a closed enum.
 */

export const PRESENTATION_FEATURES_VERSION = 'presentation-features.v1';

export const PRESENTATION_FEATURE_AXES = Object.freeze([
  'modality',
  'context_level',
  'interaction',
  'sentence_difficulty_band',
]);

export const PRESENTATION_FEATURE_DEFAULTS = Object.freeze({
  modality: 'text',
  context_level: 'unspecified',
  interaction: 'recognition',
  sentence_difficulty_band: 'unspecified',
});

// These are defaults, not validation enums.  A caller can pass any extension
// value (and any new variant id) through the same object shape.
const BUILTIN_VARIANT_FEATURES = Object.freeze({
  minimal_sentence: Object.freeze({
    modality: 'text',
    context_level: 'minimal',
    interaction: 'recognition',
    sentence_difficulty_band: 'easy',
  }),
  word_only: Object.freeze({
    modality: 'text',
    context_level: 'none',
    interaction: 'recognition',
    sentence_difficulty_band: 'none',
  }),
  audio_first: Object.freeze({
    modality: 'audio',
    context_level: 'minimal',
    interaction: 'recognition',
    sentence_difficulty_band: 'easy',
  }),
  cloze: Object.freeze({
    modality: 'text',
    context_level: 'original',
    interaction: 'cloze',
    sentence_difficulty_band: 'medium',
  }),
  original_context: Object.freeze({
    modality: 'text',
    context_level: 'original',
    interaction: 'recognition',
    sentence_difficulty_band: 'hard',
  }),
});

// The values are deliberately close.  Preference contribution can therefore
// matter among allowed candidates while remaining a small, bounded influence.
export const DEFAULT_PRESENTATION_PRIORITIES = Object.freeze({
  minimal_sentence: 0.50,
  word_only: 0.45,
  audio_first: 0.40,
  cloze: 0.35,
  original_context: 0.30,
});

export class PresentationFeatureError extends TypeError {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PresentationFeatureError';
    this.code = code;
    this.details = { ...details };
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function ownValue(source, key) {
  return Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined;
}

function cloneObject(value) {
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).map((key) => [key, value[key]]));
}

function normalizeIdentifier(value, field) {
  if (typeof value !== 'string') {
    throw new PresentationFeatureError(
      'INVALID_PRESENTATION_IDENTIFIER',
      `${field} must be a non-empty string`,
      { field },
    );
  }
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '_');
  if (!normalized) {
    throw new PresentationFeatureError(
      'INVALID_PRESENTATION_IDENTIFIER',
      `${field} must be a non-empty string`,
      { field },
    );
  }
  return normalized;
}

function normalizeFeatureValue(value, field, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') {
    throw new PresentationFeatureError(
      'INVALID_PRESENTATION_FEATURE',
      `${field} must be a non-empty string when supplied`,
      { field },
    );
  }
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '_');
  if (!normalized) return fallback;
  return normalized;
}

function normalizeCustomFeatureValue(value, field) {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase().replace(/\s+/g, '_');
    if (!normalized) {
      throw new PresentationFeatureError(
        'INVALID_PRESENTATION_FEATURE',
        `${field} must be a non-empty string`,
        { field },
      );
    }
    return normalized;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  throw new PresentationFeatureError(
    'INVALID_PRESENTATION_FEATURE',
    `${field} must be a string, finite number, or boolean`,
    { field },
  );
}

function featureDefaultsForVariant(variantId, customDefaults) {
  const builtinDefaults = ownValue(BUILTIN_VARIANT_FEATURES, variantId);
  return {
    ...PRESENTATION_FEATURE_DEFAULTS,
    ...(isPlainObject(builtinDefaults) ? builtinDefaults : {}),
    ...(isPlainObject(customDefaults) ? customDefaults : {}),
  };
}

/**
 * Normalize the four stable axes and preserve extension axes in sorted order.
 * Unknown axis values are accepted by design: adding a presentation variant
 * must not require changing this module's enum list.
 */
export function normalizePresentationFeatures(input = {}, options = {}) {
  if (!isPlainObject(input)) {
    throw new PresentationFeatureError(
      'INVALID_PRESENTATION_FEATURES',
      'features must be a plain object',
      { field: 'features' },
    );
  }

  const defaults = {
    ...PRESENTATION_FEATURE_DEFAULTS,
    ...(isPlainObject(options.defaults) ? options.defaults : {}),
  };
  const normalizedEntries = [];
  for (const axis of PRESENTATION_FEATURE_AXES) {
    normalizedEntries.push([
      axis,
      normalizeFeatureValue(
        input[axis],
        `features.${axis}`,
        normalizeFeatureValue(defaults[axis], `defaults.${axis}`, PRESENTATION_FEATURE_DEFAULTS[axis]),
      ),
    ]);
  }

  for (const key of Object.keys(input).sort(compareStrings)) {
    if (PRESENTATION_FEATURE_AXES.includes(key)) continue;
    normalizedEntries.push([
      key,
      normalizeCustomFeatureValue(input[key], `features.${key}`),
    ]);
  }
  return Object.fromEntries(normalizedEntries);
}

/**
 * Accept either a variant id or a PresentationCandidate-like object.
 * Top-level axis values are accepted as a migration convenience, while the
 * returned shape always nests them under `features`.
 */
export function normalizePresentationVariant(input, options = {}) {
  const source = typeof input === 'string'
    ? { variant_id: input }
    : input;
  if (!isPlainObject(source)) {
    throw new PresentationFeatureError(
      'INVALID_PRESENTATION_VARIANT',
      'presentation variant must be a string or plain object',
      { field: 'presentation_variant' },
    );
  }

  const rawVariantId = source.variant_id ?? source.id ?? source.variant;
  const variantId = normalizeIdentifier(rawVariantId, 'variant_id');
  const builtinDefaults = featureDefaultsForVariant(
    variantId,
    options.default_features ?? options.defaults,
  );
  const topLevelFeatures = {};
  for (const axis of PRESENTATION_FEATURE_AXES) {
    if (Object.prototype.hasOwnProperty.call(source, axis)) topLevelFeatures[axis] = source[axis];
  }
  const features = normalizePresentationFeatures(
    {
      ...topLevelFeatures,
      ...(isPlainObject(source.features) ? cloneObject(source.features) : {}),
    },
    { defaults: builtinDefaults },
  );

  return {
    variant_id: variantId,
    features,
  };
}

function variantSortKey(variant) {
  return `${variant.variant_id}\u0000${JSON.stringify(variant.features)}`;
}

/**
 * Canonicalize a candidate collection.  Duplicate ids are resolved by a
 * stable feature key, so the result does not depend on caller array order.
 */
export function normalizePresentationVariants(input) {
  if (!Array.isArray(input)) {
    throw new PresentationFeatureError(
      'INVALID_PRESENTATION_VARIANTS',
      'presentation variants must be an array',
      { field: 'presentations' },
    );
  }
  const candidates = input.map((candidate) => normalizePresentationVariant(candidate));
  const byId = new Map();
  for (const candidate of candidates) {
    const previous = byId.get(candidate.variant_id);
    if (!previous || compareStrings(variantSortKey(candidate), variantSortKey(previous)) < 0) {
      byId.set(candidate.variant_id, candidate);
    }
  }
  return [...byId.values()].sort((left, right) => (
    compareStrings(variantSortKey(left), variantSortKey(right))
  ));
}

export function presentationVariantKey(input) {
  const normalized = normalizePresentationVariant(input);
  return variantSortKey(normalized);
}

export function comparePresentationVariants(left, right) {
  const normalizedLeft = normalizePresentationVariant(left);
  const normalizedRight = normalizePresentationVariant(right);
  return compareStrings(variantSortKey(normalizedLeft), variantSortKey(normalizedRight));
}

export function getPresentationDefaultPriority(variantId, overrides = {}) {
  const normalizedId = normalizeIdentifier(variantId, 'variant_id');
  const override = isPlainObject(overrides) ? ownValue(overrides, normalizedId) : undefined;
  if (typeof override === 'number' && Number.isFinite(override)) return override;
  const defaultPriority = ownValue(DEFAULT_PRESENTATION_PRIORITIES, normalizedId);
  return typeof defaultPriority === 'number' && Number.isFinite(defaultPriority)
    ? defaultPriority
    : 0;
}

export function getBuiltinPresentationFeatures(variantId) {
  const normalizedId = normalizeIdentifier(variantId, 'variant_id');
  const builtinFeatures = ownValue(BUILTIN_VARIANT_FEATURES, normalizedId);
  return normalizePresentationFeatures(
    isPlainObject(builtinFeatures) ? builtinFeatures : {},
    { defaults: PRESENTATION_FEATURE_DEFAULTS },
  );
}
