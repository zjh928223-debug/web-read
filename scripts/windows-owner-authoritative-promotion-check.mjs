import assert from 'node:assert/strict'

import {
  WINDOWS_OWNER_AUTHORITATIVE_PROMOTION_DOMAINS,
  createAuthoritativeSourceFinalBackup,
} from './lib/windows-owner-authoritative-promotion.mjs'

const emptySnapshot = {
  schemaVersion: 1,
  adapterVersion: 1,
  revision: 0,
  records: [],
  references: [],
  mediaReferences: [],
}

const sourceAdapters = Object.fromEntries(
  WINDOWS_OWNER_AUTHORITATIVE_PROMOTION_DOMAINS.map((domain) => [domain, {
    async collect() {
      return emptySnapshot
    },
  }]),
)

await assert.rejects(
  createAuthoritativeSourceFinalBackup({
    sourceControl: {
      async status() {
        return { status: 'authoritative', frozen: false, drained: false }
      },
    },
    sourceAdapters,
    profileId: 'optimization',
    instanceId: 'source-instance',
  }),
  (error) => error?.code === 'OWNER_PROMOTION_SOURCE_NOT_FROZEN',
)

console.log('windows owner authoritative promotion red gate: source final backup requires a Host freeze')
