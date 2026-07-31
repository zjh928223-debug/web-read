#!/usr/bin/env node

import { createEcdictServiceFromEnvironment } from '../src/dictionary/ecdict/index.mjs';

const query = process.argv.slice(2).join(' ');
const service = createEcdictServiceFromEnvironment();

try {
  const result = await service.lookup(query);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.available) process.exitCode = 2;
} finally {
  service.close();
}
