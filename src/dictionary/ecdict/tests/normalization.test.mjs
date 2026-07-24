import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeDictionaryQuery } from '../domain/normalization.mjs';

test('normalizes with the ECDICT strip-word rule', () => {
  assert.equal(normalizeDictionaryQuery("Long-time!"), 'longtime');
  assert.equal(normalizeDictionaryQuery("can't"), 'cant');
  assert.equal(normalizeDictionaryQuery('不存在！'), '不存在');
  assert.equal(normalizeDictionaryQuery('...'), '');
});
