import { PgBoss } from 'pg-boss';
import { logger } from '../lib/logger.js';

export interface BossJob<T = unknown> {
  id: string;
  data: T;
}

export interface Boss {
  start(): Promise<unknown>;
  stop(options?: { graceful?: boolean; timeout?: number }): Promise<void>;
  createQueue(name: string, options?: object): Promise<void>;
  work(name: string, handler: (jobs: BossJob[]) => Promise<void>): Promise<string>;
  send(name: string, data: object, options?: { singletonKey?: string }): Promise<string | null>;
  schedule(name: string, cron: string, data?: object): Promise<void>;
  fail(name: string, id: string, data?: object): Promise<void>;
  on(event: 'error', handler: (err: Error) => void): void;
}

export async function startBoss(connectionString: string): Promise<Boss> {
  const boss = new PgBoss(connectionString);
  boss.on('error', (err: Error) => {
    logger.error({ err: err.name }, 'pg-boss error');
  });
  await boss.start();
  return boss as unknown as Boss;
}
