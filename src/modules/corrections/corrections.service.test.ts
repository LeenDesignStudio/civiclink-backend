import { describe, expect, it } from 'vitest';
import { Authz } from '../../authz/authz.js';
import type { ServiceContext } from '../../graphql/context.js';
import { FakeClock } from '../../lib/clock.js';
import {
  DuplicateCorrectionError,
  ForbiddenError,
  PreconditionError,
  ValidationError,
} from '../../lib/errors.js';
import type { CivicEntityType, CorrectionField, GovLevel } from './corrections.dto.js';
import type {
  ActiveEntity,
  AdminListQuery,
  ApplyTargetInput,
  AuditEntry,
  AuditRecorder,
  CorrectionPatch,
  CorrectionsRepo,
  NewCorrection,
  StoredCorrection,
  TxRunner,
} from './corrections.ports.js';
import { CorrectionsService } from './corrections.service.js';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EDITOR = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const VIEWER = 'vvvvvvvv-vvvv-4vvv-8vvv-vvvvvvvvvvvv';
const COMMS = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const passthrough: TxRunner = (fn) => fn(undefined);

class MemoryCorrections implements CorrectionsRepo {
  entities = new Map<string, { level: GovLevel; active: boolean; values: Partial<Record<CorrectionField, string | null>> }>();
  rows: StoredCorrection[] = [];
  names = new Map<string, string>();
  resolvers = new Set<string>();
  targets: ApplyTargetInput[] = [];
  private n = 0;

  findActiveEntity(entityType: CivicEntityType, entityId: string, field: CorrectionField): Promise<ActiveEntity | null> {
    const entity = this.entities.get(`${entityType}:${entityId}`);
    if (!entity?.active) return Promise.resolve(null);
    return Promise.resolve({
      entityType,
      entityId,
      level: entity.level,
      currentValue: entity.values[field] ?? null,
    });
  }

  async findOpen(userId: string, entityType: CivicEntityType, entityId: string, field: CorrectionField) {
    await Promise.resolve();
    return (
      this.rows.find(
        (row) =>
          row.userId === userId &&
          row.entityType === entityType &&
          row.entityId === entityId &&
          row.field === field &&
          (row.status === 'SUBMITTED' || row.status === 'IN_REVIEW'),
      ) ?? null
    );
  }

  async countSince(userId: string, since: Date) {
    await Promise.resolve();
    return this.rows.filter((row) => row.userId === userId && row.createdAt.getTime() >= since.getTime()).length;
  }

  insert(row: NewCorrection): Promise<StoredCorrection> {
    this.n += 1;
    const stored: StoredCorrection = {
      id: `00000000-0000-4000-8000-${this.n.toString(16).padStart(12, '0')}`,
      userId: row.userId,
      entityType: row.entityType,
      entityId: row.entityId,
      field: row.field,
      currentValueSnapshot: row.currentValueSnapshot,
      proposedValue: row.proposedValue,
      details: row.details,
      evidenceUrl: row.evidenceUrl,
      lookupToken: row.lookupToken,
      status: 'SUBMITTED',
      assigneeId: null,
      dismissReason: null,
      dismissNote: null,
      resolvedAt: null,
      resolvedBy: null,
      submitterDisplayName: row.submitterDisplayName,
      level: row.level,
      createdAt: row.createdAt,
      updatedAt: row.createdAt,
      notes: [],
    };
    this.rows.push(stored);
    return Promise.resolve(stored);
  }

  listOwned(userId: string): Promise<StoredCorrection[]> {
    return Promise.resolve(this.rows.filter((row) => row.userId === userId));
  }

  countOwned(userId: string): Promise<number> {
    return Promise.resolve(this.rows.filter((row) => row.userId === userId).length);
  }

  listAdmin(query: AdminListQuery): Promise<StoredCorrection[]> {
    return Promise.resolve(this.filterAdmin(query).slice(0, query.limit));
  }

  countAdmin(query: Omit<AdminListQuery, 'limit' | 'after'>): Promise<number> {
    return Promise.resolve(this.filterAdmin({ ...query, limit: 10_000 }).length);
  }

  findById(id: string): Promise<StoredCorrection | null> {
    return Promise.resolve(this.rows.find((row) => row.id === id) ?? null);
  }

  update(id: string, patch: CorrectionPatch): Promise<StoredCorrection | null> {
    const row = this.rows.find((item) => item.id === id);
    if (!row) return Promise.resolve(null);
    if (patch.status) row.status = patch.status;
    if (patch.assigneeId !== undefined) row.assigneeId = patch.assigneeId;
    if (patch.dismissReason !== undefined) row.dismissReason = patch.dismissReason;
    if (patch.dismissNote !== undefined) row.dismissNote = patch.dismissNote;
    if (patch.resolvedAt !== undefined) row.resolvedAt = patch.resolvedAt;
    if (patch.resolvedBy !== undefined) row.resolvedBy = patch.resolvedBy;
    row.updatedAt = patch.updatedAt;
    return Promise.resolve(row);
  }

  applyTarget(input: ApplyTargetInput): Promise<{ before: string | null }> {
    this.targets.push(input);
    const entity = this.entities.get(`${input.entityType}:${input.entityId}`);
    const before = entity?.values[input.field] ?? null;
    if (entity && input.value !== null) entity.values[input.field] = input.value;
    return Promise.resolve({ before });
  }

  addNote(correctionId: string, adminId: string, body: string, createdAt: Date) {
    const row = this.rows.find((item) => item.id === correctionId);
    const note = {
      id: `00000000-0000-4000-8000-${(this.n + 1).toString(16).padStart(12, '0')}`,
      adminId,
      body,
      createdAt,
    };
    row?.notes.push(note);
    return Promise.resolve(note);
  }

  assigneeCanResolve(adminId: string): Promise<boolean> {
    return Promise.resolve(this.resolvers.has(adminId));
  }

  submitterDisplayName(userId: string): Promise<string | null> {
    return Promise.resolve(this.names.get(userId) ?? null);
  }

  private filterAdmin(query: AdminListQuery): StoredCorrection[] {
    return this.rows
      .filter((row) => (query.status ? row.status === query.status : true))
      .filter((row) => (query.level ? row.level === query.level : true))
      .filter((row) => (query.entityType ? row.entityType === query.entityType : true))
      .filter((row) => (query.assigneeId ? row.assigneeId === query.assigneeId : true))
      .filter((row) => (query.olderThan ? row.createdAt.getTime() < query.olderThan.getTime() : true))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
}

class MemoryAudit implements AuditRecorder {
  readonly entries: AuditEntry[] = [];

  record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }
}

function principal(
  kind: 'resident' | 'admin',
  role: 'EDITOR' | 'VIEWER' | 'COMMUNICATIONS' = 'EDITOR',
  id = EDITOR,
): ServiceContext {
  if (kind === 'resident') {
    const residentPrincipal = {
      kind: 'resident' as const,
      userId: USER,
      status: 'ACTIVE' as const,
      termsAccepted: true,
      sessionId: 'sess-1',
    };
    return { requestId: 'req-1', principal: residentPrincipal, authz: new Authz(residentPrincipal), ipHash: 'ip-hash' };
  }
  const adminPrincipal = {
    kind: 'admin' as const,
    adminId: id,
    role: role ?? 'EDITOR',
    sessionId: 'sess-admin',
  };
  return { requestId: 'req-1', principal: adminPrincipal, authz: new Authz(adminPrincipal), ipHash: 'ip-hash' };
}

function officeId(n: number): string {
  return `11111111-1111-4111-8111-${n.toString(16).padStart(12, '0')}`;
}

function harness() {
  const repo = new MemoryCorrections();
  const audit = new MemoryAudit();
  repo.names.set(USER, 'Ada Lovelace');
  repo.resolvers.add(EDITOR);
  const clock = new FakeClock(new Date('2026-10-06T12:00:00.000Z'));
  const svc = new CorrectionsService({ repo, audit, withTx: passthrough, clock });
  const seed = (id: string) => {
    repo.entities.set(`OFFICE:${id}`, { level: 'MUNICIPAL', active: true, values: { OTHER: 'old' } });
  };
  seed(officeId(1));
  return { svc, repo, audit, seed };
}

describe('CorrectionsService', () => {
  it('rejects an invalid transition, a duplicate open report, and an 11th report the same day', async () => {
    const { svc, seed } = harness();
    const created = await svc.submitCorrection(principal('resident'), {
      entityType: 'OFFICE',
      entityId: officeId(1),
      field: 'OTHER',
      proposedValue: 'The phone changed',
    });
    await expect(
      svc.submitCorrection(principal('resident'), {
        entityType: 'OFFICE',
        entityId: officeId(1),
        field: 'OTHER',
        proposedValue: 'Another open report',
      }),
    ).rejects.toBeInstanceOf(DuplicateCorrectionError);
    await svc.applyCorrection(principal('admin'), { id: created.correction.id, value: 'The phone changed' });
    await expect(
      svc.applyCorrection(principal('admin'), { id: created.correction.id, value: 'Again' }),
    ).rejects.toBeInstanceOf(PreconditionError);

    for (let n = 2; n <= 11; n += 1) {
      const id = officeId(n);
      seed(id);
      const promise = svc.submitCorrection(principal('resident'), {
        entityType: 'OFFICE',
        entityId: id,
        field: 'OTHER',
        proposedValue: `Report ${n}`,
      });
      if (n === 11) await expect(promise).rejects.toMatchObject({ code: 'CORRECTION_DAILY_LIMIT' });
      else await promise;
    }
  });

  it('hides assignee from residents and requires a note when dismissing as Other', async () => {
    const { svc, audit } = harness();
    const created = await svc.submitCorrection(principal('resident'), {
      entityType: 'OFFICE',
      entityId: officeId(1),
      field: 'OTHER',
      proposedValue: 'Wrong title',
    });
    await svc.addCorrectionNote(principal('admin'), { id: created.correction.id, body: 'Checking the source.' });
    const mine = await svc.myCorrections(principal('resident'), {});
    const node = mine.edges[0]?.node;
    expect(node).toBeDefined();
    expect(node && 'assigneeId' in node).toBe(false);
    expect(node && 'notes' in node).toBe(false);
    expect(JSON.stringify(node)).not.toContain('ada@');

    await expect(
      svc.dismissCorrection(principal('admin'), { id: created.correction.id, reason: 'OTHER' }),
    ).rejects.toBeInstanceOf(ValidationError);
    const dismissed = await svc.dismissCorrection(principal('admin'), {
      id: created.correction.id,
      reason: 'OTHER',
      note: 'Not enough to change the record.',
    });
    expect(dismissed.correction.status).toBe('DISMISSED');
    expect(dismissed.correction.dismissNote).toContain('Not enough');

    const detail = await svc.adminCorrection(principal('admin', 'VIEWER', VIEWER), { id: created.correction.id });
    expect(detail.submitterDisplayName).toBe('Ada Lovelace');
    expect(JSON.stringify(detail)).not.toContain('email');
    expect(audit.entries.filter((entry) => entry.action === 'APPLY')).toHaveLength(0);
  });

  it('writes two audit rows when applying and blocks viewers and communications', async () => {
    const { svc, audit } = harness();
    const created = await svc.submitCorrection(principal('resident'), {
      entityType: 'OFFICE',
      entityId: officeId(1),
      field: 'OTHER',
      proposedValue: 'Updated name',
    });
    expect(audit.entries[0]).toMatchObject({ actorType: 'RESIDENT', actorId: null, action: 'SUBMIT' });
    await expect(
      svc.markCorrectionInReview(principal('admin', 'VIEWER', VIEWER), { id: created.correction.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      svc.dismissCorrection(principal('admin', 'COMMUNICATIONS', COMMS), {
        id: created.correction.id,
        reason: 'DUPLICATE',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await svc.applyCorrection(principal('admin'), { id: created.correction.id, value: 'Updated name' });
    const applied = audit.entries.filter((entry) => entry.action === 'APPLY' || entry.action === 'UPDATE');
    expect(applied).toHaveLength(2);
    expect(applied.map((entry) => entry.entityType).sort()).toEqual(['Correction', 'OFFICE']);
  });
});
