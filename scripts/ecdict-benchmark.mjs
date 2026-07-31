#!/usr/bin/env node

import { performance } from 'node:perf_hooks';

import { readEcdictConfig } from '../src/dictionary/ecdict/application/ecdict-config.mjs';
import { EcdictRepository } from '../src/dictionary/ecdict/infrastructure/ecdict-repository.mjs';

function measure(operation, iterations) {
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    operation();
    samples.push(performance.now() - started);
  }
  samples.sort((left, right) => left - right);
  const percentile = (value) => samples[Math.min(
    samples.length - 1,
    Math.floor(samples.length * value),
  )];
  return {
    iterations,
    averageMs: Number(
      (samples.reduce((total, sample) => total + sample, 0) / samples.length).toFixed(4),
    ),
    p50Ms: Number(percentile(0.5).toFixed(4)),
    p95Ms: Number(percentile(0.95).toFixed(4)),
  };
}

const config = readEcdictConfig();
if (!config.enabled) {
  throw new Error('Set ECDICT_ENABLED=true before running the benchmark.');
}

const iterations = Math.max(1, Number(process.env.ECDICT_BENCHMARK_ITERATIONS || 1000));
const repository = new EcdictRepository(config.databasePath);
try {
  repository.findExact('look');
  repository.findNormalized('longtime');
  repository.findLemmaCandidates('looked');
  const report = {
    databasePath: config.databasePath,
    exact: measure(() => repository.findExact('look'), iterations),
    normalized: measure(() => repository.findNormalized('longtime'), iterations),
    lemma: measure(() => repository.findLemmaCandidates('looked'), iterations),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  repository.close();
}
