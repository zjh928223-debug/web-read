import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export class EcdictDatabaseError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'EcdictDatabaseError';
    this.code = code;
  }
}

export function openReadOnlyEcdictDatabase(databasePath) {
  if (!databasePath || !existsSync(databasePath)) {
    throw new EcdictDatabaseError(
      'ECDICT_DATABASE_UNAVAILABLE',
      `ECDICT database is unavailable: ${databasePath || '(not configured)'}`,
    );
  }

  let database = null;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const schema = database
      .prepare("SELECT value FROM build_metadata WHERE key = 'schema_version'")
      .get();
    if (schema?.value !== '1') {
      database.close();
      throw new EcdictDatabaseError(
        'ECDICT_DATABASE_INVALID',
        'ECDICT database schema is missing or unsupported.',
      );
    }
    return database;
  } catch (error) {
    try {
      database?.close();
    } catch {
      // Preserve the original validation/open error.
    }
    if (error instanceof EcdictDatabaseError) throw error;
    throw new EcdictDatabaseError(
      'ECDICT_DATABASE_INVALID',
      'ECDICT database could not be opened read-only.',
      { cause: error },
    );
  }
}
