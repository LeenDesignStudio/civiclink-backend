import { Authz, systemPrincipal } from '../../authz/authz.js';
import type { ServiceContext } from '../../graphql/context.js';
import { isKnownCollector } from './collectors.js';
import type { SourceRow } from './records.js';
import type { RunCounts } from './types.js';

export interface PilotScope {
  state?: string;
  county?: string;
  tigerYear?: number;
}

export interface RunArgs {
  collectorKey: string;
  state?: string;
  county?: string;
  dryRun: boolean;
}

export interface PilotArgs {
  state: string;
  county: string;
  dryRun: boolean;
}

const PILOT_KEYS = ['tiger.boundaries', 'congress.legislators', 'openstates.people'] as const;

export function parseRunArgs(argv: string[]): RunArgs {
  const dryRun = argv.includes('--dry-run');
  const state = readFlag(argv, '--state');
  const county = readFlag(argv, '--county');
  const collectorKey = positionalArgs(argv)[0];
  if (!collectorKey) throw new Error('Usage: pnpm pipeline:run <collectorKey> [--state MD] [--county Montgomery] [--dry-run]');
  return { collectorKey, dryRun, ...(state ? { state } : {}), ...(county ? { county } : {}) };
}

export function parsePilotArgs(argv: string[]): PilotArgs {
  const dryRun = argv.includes('--dry-run');
  const state = readFlag(argv, '--state');
  const county = readFlag(argv, '--county');
  if (!state || !county) throw new Error('Usage: pnpm pipeline:pilot --state MD --county Montgomery [--dry-run]');
  return { state, county, dryRun };
}

export function planForPilot(sources: SourceRow[], scope: { state: string; county: string }): SourceRow[] {
  const ordered: SourceRow[] = [];
  for (const key of PILOT_KEYS) {
    const found = sources.find((row) => row.active && row.collectorKey === key);
    if (!found) throw new Error(`No active source for collector ${key}. Run pnpm db:seed:sources.`);
    ordered.push(found);
  }
  const pages = sources
    .filter((row) => row.active && row.collectorKey === 'page.directory' && placeMatch(row, scope))
    .sort((left, right) => left.name.localeCompare(right.name));
  return [...ordered, ...pages];
}

export function planForCollector(sources: SourceRow[], args: { collectorKey: string; state?: string; county?: string }): SourceRow[] {
  if (!isKnownCollector(args.collectorKey)) throw new Error(`Unknown collector ${args.collectorKey}.`);
  let rows = sources.filter((row) => row.active && row.collectorKey === args.collectorKey);
  if (args.collectorKey === 'page.directory' && args.state && args.county) {
    const state = args.state;
    const county = args.county;
    rows = rows.filter((row) => placeMatch(row, { state, county }));
  }
  if (rows.length === 0) throw new Error(`No active source for collector ${args.collectorKey}. Run pnpm db:seed:sources.`);
  return rows.sort((left, right) => left.name.localeCompare(right.name));
}

export function formatCounts(collectorKey: string, counts: RunCounts, dryRun: boolean): string {
  const head = dryRun ? `dry-run ${collectorKey}` : collectorKey;
  const skipped = counts.skipped ? ' skipped=true' : '';
  const sha = counts.sha ? ` sha=${counts.sha}` : '';
  const note = counts.note ? ` ${counts.note}` : '';
  return `${head} added=${counts.added} changed=${counts.changed} retired=${counts.retired} pending=${counts.pending}${skipped}${sha}${note}`;
}

export function runInput(sourceId: string, scope: PilotScope): { sourceId: string; state?: string; county?: string; tigerYear?: number } {
  return {
    sourceId,
    ...(scope.state ? { state: scope.state } : {}),
    ...(scope.county ? { county: scope.county } : {}),
    ...(scope.tigerYear ? { tigerYear: scope.tigerYear } : {}),
  };
}

export async function executePlan(input: {
  plan: SourceRow[];
  scope: PilotScope;
  dryRun: boolean;
  run: (sourceId: string, scope: PilotScope) => Promise<RunCounts>;
  preview: (sourceId: string, scope: PilotScope) => Promise<RunCounts>;
}): Promise<string[]> {
  const lines: string[] = [];
  for (const source of input.plan) {
    const counts = input.dryRun ? await input.preview(source.id, input.scope) : await input.run(source.id, input.scope);
    lines.push(formatCounts(source.collectorKey ?? source.name, counts, input.dryRun));
  }
  return lines;
}

export function pipelineContext(): ServiceContext {
  const principal = systemPrincipal('pipeline.cli');
  return { requestId: 'pipeline.cli', principal, authz: new Authz(principal), ipHash: 'system' };
}

function placeMatch(row: SourceRow, scope: { state: string; county: string }): boolean {
  return sameText(row.config.state, scope.state) && sameText(row.config.county, scope.county);
}

function sameText(left: string | undefined, right: string): boolean {
  return (left ?? '').trim().toLowerCase() === right.trim().toLowerCase();
}

function readFlag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}.`);
  return value;
}

function positionalArgs(argv: string[]): string[] {
  const skip = new Set<number>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--state' || arg === '--county') {
      skip.add(index);
      skip.add(index + 1);
    }
    if (arg === '--dry-run') skip.add(index);
  }
  return argv.filter((_, index) => !skip.has(index));
}
