const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const configPath = path.join(root, 'config', 'ielts-learning-pools.json')
const servicePath = path.join(root, 'src', 'services', 'vocabulary', 'ielts-learning-pools.js')
const indexPath = path.join(root, 'src', 'services', 'vocabulary', 'index.js')
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
const service = fs.readFileSync(servicePath, 'utf8')
const index = fs.readFileSync(indexPath, 'utf8')

const expectedFullLearning = [5, 6, 7, 8, 9, 10, 11, 15, 16, 17, 18, 19, 20, 21]
const expectedReadingVocabulary = [4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 20, 21]

assert.equal(config.schemaVersion, 'ielts-learning-pools.v1')
assert.deepEqual(config.pools.fullLearning.books, expectedFullLearning)
assert.deepEqual(config.pools.readingVocabulary.books, expectedReadingVocabulary)
assert.equal(new Set(config.pools.fullLearning.books).size, expectedFullLearning.length)
assert.equal(new Set(config.pools.readingVocabulary.books).size, expectedReadingVocabulary.length)
assert.equal(config.pools.fullLearning.books.includes(12), false)
assert.equal(config.pools.readingVocabulary.books.includes(12), false)
assert.equal(config.pools.fullLearning.books.includes(4), false)
assert.equal(config.pools.readingVocabulary.books.includes(4), true)
assert.equal(config.pools.fullLearning.books.includes(13), false)
assert.equal(config.pools.readingVocabulary.books.includes(13), true)
assert.equal(config.pools.fullLearning.books.includes(14), false)
assert.equal(config.pools.readingVocabulary.books.includes(14), true)
assert.match(service, /getIeltsLearningPoolBooks/)
assert.match(service, /getIeltsBookPoolEligibility/)
assert.match(index, /ielts-learning-pools\.js/)

console.log('PASS: IELTS full-learning and reading-vocabulary pools match the approved book ranges.')
