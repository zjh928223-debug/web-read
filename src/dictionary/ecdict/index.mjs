import { readEcdictConfig } from './application/ecdict-config.mjs';
import { createEcdictService } from './application/ecdict-service.mjs';

export { createEcdictService } from './application/ecdict-service.mjs';

export function createEcdictServiceFromEnvironment(environment = process.env) {
  return createEcdictService(readEcdictConfig(environment));
}
