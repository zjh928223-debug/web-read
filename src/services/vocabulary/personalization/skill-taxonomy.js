export const SKILL_TAXONOMY_SCHEMA_VERSION = 'skill-taxonomy.v1';
export const SKILL_TAXONOMY_VERSION = SKILL_TAXONOMY_SCHEMA_VERSION;

const DEFAULT_SKILL_DEFINITIONS = [
  {
    id: 'pos.noun',
    family: 'pos',
    label: 'noun',
    description: 'Recognize and use the noun part of speech.',
    order: 10,
  },
  {
    id: 'pos.verb',
    family: 'pos',
    label: 'verb',
    description: 'Recognize and use the verb part of speech.',
    order: 20,
  },
  {
    id: 'pos.adjective',
    family: 'pos',
    label: 'adjective',
    description: 'Recognize and use the adjective part of speech.',
    order: 30,
  },
  {
    id: 'pos.adverb',
    family: 'pos',
    label: 'adverb',
    description: 'Recognize and use the adverb part of speech.',
    order: 40,
  },
  {
    id: 'morphology.inflection',
    family: 'morphology',
    label: 'inflection',
    description: 'Recognize inflected forms of a known word.',
    order: 50,
  },
  {
    id: 'morphology.derivation',
    family: 'morphology',
    label: 'derivation',
    description: 'Recognize a derived form and its relationship to a base.',
    order: 60,
  },
  {
    id: 'morphology.irregular',
    family: 'morphology',
    label: 'irregular',
    description: 'Recognize an irregular form or irregular change.',
    order: 70,
  },
  {
    id: 'sense.primary',
    family: 'sense',
    label: 'primary sense',
    description: 'Recognize the selected primary target sense.',
    order: 80,
  },
  {
    id: 'sense.secondary',
    family: 'sense',
    label: 'secondary sense',
    description: 'Distinguish and use a secondary target sense.',
    order: 90,
  },
  {
    id: 'usage.collocation',
    family: 'usage',
    label: 'collocation',
    description: 'Recognize and use a conventional word combination.',
    order: 100,
  },
  {
    id: 'usage.context_transfer',
    family: 'usage',
    label: 'context transfer',
    description: 'Transfer recognition of a target sense to a new context.',
    order: 110,
  },
];

function clone(value) {
  if (Array.isArray(value)) return value.map((item) => clone(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function compareText(left, right) {
  return left < right ? -1 : (left > right ? 1 : 0);
}

function normalizeDefinition(input, fallbackOrder) {
  const source = input && typeof input === 'object' ? input : {};
  const id = normalizeString(source.id);
  if (!id || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i.test(id)) return null;

  const family = normalizeString(source.family) || id.split('.')[0];
  const label = normalizeString(source.label) || id;
  const description = normalizeString(source.description) || `Skill: ${id}`;
  const order = Number.isFinite(source.order) ? source.order : fallbackOrder;
  const aliases = Array.isArray(source.aliases)
    ? [...new Set(source.aliases.map(normalizeString).filter(Boolean))].sort(compareText)
    : [];

  return {
    id,
    family,
    label,
    description,
    order,
    ...(aliases.length > 0 ? { aliases } : {}),
  };
}

function sortDefinitions(definitions) {
  return [...definitions].sort((left, right) => (
    left.order - right.order || compareText(left.id, right.id)
  ));
}

function definitionsFromInput(input) {
  if (Array.isArray(input)) return input;
  if (input && typeof input === 'object') {
    return Object.entries(input).map(([id, definition]) => ({
      ...(definition && typeof definition === 'object' ? definition : {}),
      id: definition?.id ?? id,
    }));
  }
  return [];
}

/**
 * Create a versioned taxonomy without sharing mutable objects with the caller.
 * Custom definitions replace a default with the same id and append new ids.
 */
export function createSkillTaxonomy(options = {}) {
  const source = options && typeof options === 'object' ? options : {};
  const version = normalizeString(source.version) || SKILL_TAXONOMY_VERSION;
  const includeDefaults = source.include_defaults !== false && source.includeDefaults !== false;
  const byId = new Map();

  if (includeDefaults) {
    DEFAULT_SKILL_DEFINITIONS.forEach((definition, index) => {
      byId.set(definition.id, normalizeDefinition(definition, (index + 1) * 10));
    });
  }

  for (const [index, input] of definitionsFromInput(source.skills ?? source.definitions).entries()) {
    const definition = normalizeDefinition(input, (index + 1) * 10);
    if (!definition) continue;
    byId.set(definition.id, definition);
  }

  const skills = sortDefinitions([...byId.values()]);
  return freezeDeep({
    schema_version: SKILL_TAXONOMY_SCHEMA_VERSION,
    version,
    skills,
  });
}

export const SKILL_TAXONOMY = createSkillTaxonomy();
export const DEFAULT_SKILL_TAXONOMY = SKILL_TAXONOMY;
export const SKILL_IDS = Object.freeze(SKILL_TAXONOMY.skills.map((skill) => skill.id));

function taxonomySkills(taxonomy) {
  return Array.isArray(taxonomy?.skills) ? taxonomy.skills : SKILL_TAXONOMY.skills;
}

export function getSkillDefinition(skillId, taxonomy = SKILL_TAXONOMY) {
  const normalizedId = normalizeString(skillId);
  const skill = taxonomySkills(taxonomy).find((candidate) => candidate.id === normalizedId);
  return skill ? clone(skill) : null;
}

export function isKnownSkill(skillId, taxonomy = SKILL_TAXONOMY) {
  return Boolean(getSkillDefinition(skillId, taxonomy));
}

/**
 * Normalize tags while retaining unknown ids for auditability. Estimators use
 * the known subset and never silently create a new taxonomy dimension.
 */
export function normalizeSkillTags(tags, taxonomy = SKILL_TAXONOMY) {
  const values = Array.isArray(tags) ? tags : (tags == null ? [] : [tags]);
  const normalized = [...new Set(values.map(normalizeString).filter(Boolean))].sort();
  const knownIds = new Set(taxonomySkills(taxonomy).map((skill) => skill.id));
  const known = normalized.filter((skillId) => knownIds.has(skillId));
  const unknown = normalized.filter((skillId) => !knownIds.has(skillId));

  return {
    skill_tags: normalized,
    known_skill_tags: known,
    unknown_skill_tags: unknown,
    reasons: unknown.length > 0 ? ['UNKNOWN_SKILL'] : [],
  };
}

export function compareSkillIds(leftId, rightId, taxonomy = SKILL_TAXONOMY) {
  const left = getSkillDefinition(leftId, taxonomy);
  const right = getSkillDefinition(rightId, taxonomy);
  if (!left && !right) return compareText(String(leftId), String(rightId));
  if (!left) return 1;
  if (!right) return -1;
  return left.order - right.order || compareText(left.id, right.id);
}

export const SKILL_FAMILIES = Object.freeze(
  [...new Set(SKILL_TAXONOMY.skills.map((skill) => skill.family))].sort(),
);
