import { inject, provide } from 'vue'

const readerSessionPersistenceKey = Symbol('reader-session-persistence')

export function provideReaderSessionPersistence(persistence) {
  provide(readerSessionPersistenceKey, persistence.consumer)
}

export function useReaderSessionPersistenceContext() {
  const persistence = inject(readerSessionPersistenceKey, null)
  if (!persistence) throw new Error('Reader session persistence provider is missing')
  return persistence
}
