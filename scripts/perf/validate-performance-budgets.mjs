import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..", "..");
const configPath = resolve(projectRoot, "config", "performance-budgets.json");
const failures = [];

function fail(path, message) {
  failures.push(`${path}: ${message}`);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

let config;
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch (error) {
  console.error(`Unable to parse ${configPath}: ${error.message}`);
  process.exit(1);
}

if (config.schema !== "read-web.performance-budgets") {
  fail("schema", 'must equal "read-web.performance-budgets"');
}
if (!Number.isInteger(config.version) || config.version < 1) {
  fail("version", "must be a positive integer");
}
if (!new Set(["provisional", "active"]).has(config.status)) {
  fail("status", 'must be "provisional" or "active"');
}

for (const key of ["profileId", "workspaceKind", "platform", "fixture"]) {
  if (!isNonEmptyString(config.environment?.[key])) {
    fail(`environment.${key}`, "must be a non-empty string");
  }
}
if (!isNonEmptyString(config.environment?.frontend?.buildMode)) {
  fail("environment.frontend.buildMode", "must identify the measured frontend build mode");
}
if (!isNonEmptyString(config.environment?.backend?.dataKind)) {
  fail("environment.backend.dataKind", "must identify whether real or isolated data was measured");
}

for (const key of ["kind", "capturedAt", "source", "method"]) {
  if (!isNonEmptyString(config.baseline?.[key])) {
    fail(`baseline.${key}`, "must be a non-empty string");
  }
}
if (config.status === "active") {
  if (!isNonEmptyString(config.baseline?.id)) fail("baseline.id", "is required for an active baseline");
  if (!Number.isInteger(config.baseline?.sampleRuns) || config.baseline.sampleRuns < 3) fail("baseline.sampleRuns", "must be at least 3 for an active baseline");
  const gates = config.releaseGate?.browser;
  const candidate = config.releaseGate?.candidate;
  if (!isNonEmptyString(candidate?.fixture?.schema) || !Number.isInteger(candidate?.fixture?.version)) fail("releaseGate.candidate.fixture", "must identify fixture schema and version");
  if (!Number.isInteger(candidate?.runCount) || candidate.runCount < 3) fail("releaseGate.candidate.runCount", "must be at least 3");
  if (!Array.isArray(candidate?.journeys) || candidate.journeys.length !== 7 || new Set(candidate.journeys).size !== candidate.journeys.length) fail("releaseGate.candidate.journeys", "must contain seven unique fixed journeys");
  if (!Array.isArray(gates) || gates.length === 0) fail("releaseGate.browser", "must define at least one enforced browser metric");
  for (const [index, gate] of (gates || []).entries()) {
    const gatePath = `releaseGate.browser[${index}]`;
    for (const key of ["id", "source", "statistic", "unit"]) if (!isNonEmptyString(gate[key])) fail(`${gatePath}.${key}`, "must be a non-empty string");
    if (!Number.isInteger(gate.minimumSamples) || gate.minimumSamples < 1) fail(`${gatePath}.minimumSamples`, "must be a positive integer");
    if (!isFiniteNonNegative(gate.limit)) fail(`${gatePath}.limit`, "must be a finite non-negative number");
  }
}
for (const key of ["limitations", "activationRequirements"]) {
  const values = config.baseline?.[key];
  if (!Array.isArray(values) || values.length === 0 || values.some((value) => !isNonEmptyString(value))) {
    fail(`baseline.${key}`, "must be a non-empty list of non-empty strings");
  }
}

const requiredCategories = ["startup", "interaction", "localApi", "longTask"];
const knownCategories = Object.keys(config.budgets ?? {});
for (const category of requiredCategories) {
  if (!Array.isArray(config.budgets?.[category]) || config.budgets[category].length === 0) {
    fail(`budgets.${category}`, "must contain at least one metric");
  }
}
for (const category of knownCategories) {
  if (!requiredCategories.includes(category)) {
    fail(`budgets.${category}`, "is not a recognized version 1 category");
  }
}

const ids = new Set();
for (const category of requiredCategories) {
  for (const [index, budget] of (config.budgets?.[category] ?? []).entries()) {
    const path = `budgets.${category}[${index}]`;
    for (const key of ["id", "metric", "unit", "statistic", "context"]) {
      if (!isNonEmptyString(budget[key])) fail(`${path}.${key}`, "must be a non-empty string");
    }
    if (ids.has(budget.id)) fail(`${path}.id`, `duplicates ${budget.id}`);
    ids.add(budget.id);

    const observed = budget.observed;
    const hasValue = Object.hasOwn(observed ?? {}, "value");
    const hasRange = Object.hasOwn(observed ?? {}, "min") || Object.hasOwn(observed ?? {}, "max");
    if (!observed || hasValue === hasRange) {
      fail(`${path}.observed`, "must contain exactly one of value or min/max");
    } else if (hasValue) {
      if (observed.value === null) {
        if (!isNonEmptyString(observed.reason)) {
          fail(`${path}.observed.reason`, "is required when value is null");
        }
      } else if (!isFiniteNonNegative(observed.value)) {
        fail(`${path}.observed.value`, "must be null or a finite non-negative number");
      }
    } else if (!isFiniteNonNegative(observed.min) || !isFiniteNonNegative(observed.max) || observed.min > observed.max) {
      fail(`${path}.observed`, "min and max must be finite non-negative numbers with min <= max");
    }

    if (!new Set(["report-only", "enforced"]).has(budget.gate?.mode)) {
      fail(`${path}.gate.mode`, 'must be "report-only" or "enforced"');
    }
    if (budget.gate?.mode === "report-only" && budget.gate.limit !== null) {
      fail(`${path}.gate.limit`, "must be null for report-only metrics");
    }
    if (budget.gate?.mode === "enforced" && !isFiniteNonNegative(budget.gate.limit)) {
      fail(`${path}.gate.limit`, "must be a finite non-negative number for enforced metrics");
    }
    if (config.status === "provisional" && budget.gate?.mode !== "report-only") {
      fail(`${path}.gate.mode`, "provisional baselines cannot enable hard enforcement");
    }
  }
}

if (failures.length > 0) {
  console.error("Performance budget validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const metricCount = requiredCategories.reduce(
  (total, category) => total + config.budgets[category].length,
  0,
);
console.log(`Performance budgets valid: schema v${config.version}, ${config.status}, ${metricCount} diagnostic metrics and ${config.releaseGate?.browser?.length || 0} browser release gates`);
