export function readEcdictConfig(environment = process.env) {
  return {
    enabled: environment.ECDICT_ENABLED === 'true',
    databasePath: environment.ECDICT_DATABASE_PATH || undefined,
  };
}
