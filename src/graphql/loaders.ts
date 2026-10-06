import type { AppServices } from '../app/services.js';

export interface Loaders {
  readonly services: AppServices;
}

export function createLoaders(services: AppServices): Loaders {
  return { services };
}
