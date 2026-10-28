export type LevelName = 'FEDERAL' | 'STATE' | 'COUNTY' | 'MUNICIPAL' | 'EDUCATION' | 'SPECIAL';
export type FreshnessName = 'CURRENT' | 'MAY_BE_OUTDATED';
export type FreshnessForce = 'NONE' | 'FORCE_CURRENT' | 'FORCE_OUTDATED';
export type SourceHealthName = 'HEALTHY' | 'OVERDUE' | 'FAILED' | 'PAUSED';

const DAY_MS = 24 * 60 * 60 * 1000;
const RANK: Record<LevelName, number> = {
  FEDERAL: 0,
  STATE: 1,
  COUNTY: 2,
  MUNICIPAL: 3,
  EDUCATION: 2,
  SPECIAL: 2,
};

export function formatDisplayId(prefix: string, sequence: number): string {
  return `${prefix}-${String(sequence).padStart(4, '0')}`;
}

export function parentRequired(level: LevelName): boolean {
  return level !== 'FEDERAL';
}

/** Parent sits at the same level or a higher one. Education and special districts sit under a state or a county. */
export function parentLevelAllowed(child: LevelName, parent: LevelName): boolean {
  if (child === 'EDUCATION' || child === 'SPECIAL') return parent === 'STATE' || parent === 'COUNTY';
  return RANK[parent] <= RANK[child];
}

export function freshnessLabel(input: {
  lastUpdatedAt: Date;
  outdatedAfterDays: number;
  now: Date;
  override: FreshnessForce;
}): FreshnessName {
  if (input.override === 'FORCE_CURRENT') return 'CURRENT';
  if (input.override === 'FORCE_OUTDATED') return 'MAY_BE_OUTDATED';
  const age = input.now.getTime() - input.lastUpdatedAt.getTime();
  return age <= input.outdatedAfterDays * DAY_MS ? 'CURRENT' : 'MAY_BE_OUTDATED';
}

export function needsValidation(lastValidatedAt: Date, now: Date): boolean {
  return now.getTime() - lastValidatedAt.getTime() > 180 * DAY_MS;
}

export function boundaryStatus(hasBoundary: boolean): 'OK' | 'MISSING' {
  return hasBoundary ? 'OK' : 'MISSING';
}

export function sourceHealth(input: {
  status: 'ACTIVE' | 'PAUSED' | 'RETIRED';
  lastRunFailed: boolean;
  lastSuccessAt: Date | null;
  outdatedAfterDays: number;
  now: Date;
}): SourceHealthName {
  if (input.status === 'PAUSED' || input.status === 'RETIRED') return 'PAUSED';
  if (input.lastRunFailed) return 'FAILED';
  if (!input.lastSuccessAt) return 'OVERDUE';
  const age = input.now.getTime() - input.lastSuccessAt.getTime();
  return age > input.outdatedAfterDays * DAY_MS ? 'OVERDUE' : 'HEALTHY';
}

export interface JurisdictionTreeRow {
  id: string;
  parentId: string | null;
  name: string;
  displayId: string;
  level: LevelName;
  status: 'ACTIVE' | 'RETIRED';
  parentRetired: boolean;
}

export interface JurisdictionTreeNode extends JurisdictionTreeRow {
  children: JurisdictionTreeNode[];
}

export function nestJurisdictions(rows: JurisdictionTreeRow[], rootId: string | null): JurisdictionTreeNode[] {
  const nodes = new Map<string, JurisdictionTreeNode>();
  for (const row of rows) nodes.set(row.id, { ...row, children: [] });
  const roots: JurisdictionTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  if (!rootId) return roots;
  const root = nodes.get(rootId);
  return root ? [root] : [];
}

const PROTECTED = ['name', 'sourceId', 'sourceRecordUrl', 'lastUpdatedAt'] as const;

/** A refresh must not replace a field an admin has overridden. It flags the row when the source now differs. */
export function refreshWrite<T extends Record<string, unknown>>(
  existing: { overrideActive: boolean } & Record<string, unknown>,
  incoming: T,
): { data: Partial<T>; sourceChangedSinceOverride: boolean } {
  if (!existing.overrideActive) return { data: incoming, sourceChangedSinceOverride: false };
  const data: Partial<T> = {};
  let changed = false;
  for (const key of Object.keys(incoming) as (keyof T)[]) {
    if ((PROTECTED as readonly string[]).includes(String(key))) {
      if (existing[String(key)] !== incoming[key]) changed = true;
      continue;
    }
    data[key] = incoming[key];
  }
  return { data, sourceChangedSinceOverride: changed };
}
