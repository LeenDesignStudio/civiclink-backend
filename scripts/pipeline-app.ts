import { prisma } from '../src/db/prisma.js';
import { env } from '../src/config/env.js';
import { isAppError } from '../src/lib/errors.js';
import { AuditRepo } from '../src/modules/audit/audit.repo.js';
import { AuditService } from '../src/modules/audit/audit.service.js';
import {
  executePlan,
  parsePilotArgs,
  parseRunArgs,
  pipelineContext,
  planForCollector,
  planForPilot,
  runInput,
  type PilotScope,
} from '../src/modules/pipeline/cli.js';
import { httpGet } from '../src/modules/pipeline/http.js';
import { convertTigerZip } from '../src/modules/pipeline/ogr.js';
import { createRequestPacer } from '../src/modules/pipeline/pace.js';
import { PipelineRepo } from '../src/modules/pipeline/pipeline.repo.js';
import { PipelineService } from '../src/modules/pipeline/pipeline.service.js';
import type { SourceRow } from '../src/modules/pipeline/records.js';
import { civicLinkUserAgent } from '../src/modules/pipeline/types.js';

export async function runCollectorCli(argv: string[]): Promise<void> {
  const args = parseRunArgs(argv);
  const scope: PilotScope = { tigerYear: env.TIGER_YEAR };
  if (args.state) scope.state = args.state;
  if (args.county) scope.county = args.county;
  const store = new PipelineRepo(prisma);
  const sources = await store.listActiveSources();
  const plan = planForCollector(sources, args);
  await printPlan(plan, scope, args.dryRun);
}

export async function runPilotCli(argv: string[]): Promise<void> {
  const args = parsePilotArgs(argv);
  const scope: PilotScope = { state: args.state, county: args.county, tigerYear: env.TIGER_YEAR };
  const store = new PipelineRepo(prisma);
  const sources = await store.listActiveSources();
  const plan = planForPilot(sources, { state: args.state, county: args.county });
  await printPlan(plan, scope, args.dryRun);
}

async function printPlan(plan: SourceRow[], scope: PilotScope, dryRun: boolean): Promise<void> {
  const service = new PipelineService({
    store: new PipelineRepo(prisma),
    fetch: { get: httpGet },
    audit: new AuditService(new AuditRepo(prisma)),
    userAgent: civicLinkUserAgent(env.CONTACT_INBOX),
    pace: createRequestPacer(1000),
    convertZip: convertTigerZip,
  });
  const ctx = pipelineContext();
  const lines = await executePlan({
    plan,
    scope,
    dryRun,
    run: (sourceId, next) => service.runSource(ctx, runInput(sourceId, next)),
    preview: (sourceId, next) => service.previewSource(ctx, runInput(sourceId, next)),
  });
  for (const line of lines) process.stdout.write(`${line}\n`);
}

export function reportCliError(err: unknown): void {
  if (isAppError(err)) {
    process.stderr.write(`${err.message}\n`);
    return;
  }
  if (err instanceof Error && !/postgres|password|secret|token/i.test(err.message)) {
    process.stderr.write(`${err.message}\n`);
    return;
  }
  process.stderr.write('Pipeline run failed.\n');
}
