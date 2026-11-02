import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { AppServices } from '../../app/services.js';
import type { Principal } from '../../authz/authz.js';
import { withTx } from '../../db/prisma.js';
import { buildServer } from '../../http/server.js';
import { MemoryRateGate } from '../../lib/rate-limit.js';
import { AuditRepo } from '../audit/audit.repo.js';
import { AuditService } from '../audit/audit.service.js';
import { appDb, ownerDb, truncateAll } from '../../../test/setup/db.js';
import { expectCode, type GraphQLResult } from '../../../test/gql.js';
import { createAdminUser, createJurisdiction, createOffice, createSource } from '../../../test/factories/index.js';
import { AdminReadRepo } from './admin-read.repo.js';
import { AdminReadService } from './admin-read.service.js';

const USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SESSION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

let app: PrismaClient;
let owner: PrismaClient;
let server: FastifyInstance;
let current: Principal;
let adminId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function principal(role: 'Resident' | 'ADMIN_STAFF' | 'SUPER_ADMIN'): Principal {
  if (role === 'Resident') {
    return { kind: 'resident', userId: USER_ID, status: 'ACTIVE', termsAccepted: true, sessionId: SESSION_ID };
  }
  return { kind: 'admin', adminId, role, sessionId: SESSION_ID };
}

async function execute(role: 'Resident' | 'ADMIN_STAFF' | 'SUPER_ADMIN', query: string, variables?: Record<string, unknown>): Promise<GraphQLResult> {
  current = principal(role);
  const response = await server.inject({
    method: 'POST',
    url: '/graphql',
    headers: {
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
      'x-civiclink-csrf': '1',
    },
    payload: variables ? { query, variables } : { query },
  });
  return { status: response.statusCode, body: response.json<GraphQLResult['body']>() };
}

describe('admin read', () => {
  beforeAll(async () => {
    app = appDb();
    owner = ownerDb();
    const audit = new AuditService(new AuditRepo(app));
    const adminRead = new AdminReadService({
      store: new AdminReadRepo(app),
      audit,
      clock: { now: () => new Date('2026-06-10T12:00:00.000Z') },
      runTx: (fn) => withTx((tx) => fn(tx), { client: app }),
    });
    server = await buildServer({
      services: { adminRead, audit } as AppServices,
      rateGate: new MemoryRateGate(),
      readiness: { isShuttingDown: () => false, pingDb: () => Promise.resolve(true) },
      resolvePrincipal: () => Promise.resolve(current),
    });
  });

  beforeEach(async () => {
    await truncateAll(owner);
    const admin = await createAdminUser(owner);
    adminId = admin.id;
    const source = await createSource(owner);
    const jurisdiction = await createJurisdiction(owner, source.id, { name: 'Pilot County', type: 'COUNTY', level: 'COUNTY' });
    await owner.jurisdiction.update({ where: { id: jurisdiction.id }, data: { isPilot: true } });
    const office = await createOffice(owner, jurisdiction.id, source.id);
    await owner.changeLog.create({
      data: {
        actorType: 'ADMIN',
        actorId: admin.id,
        entityType: 'OFFICE',
        entityId: office.id,
        action: 'CREATE',
        requestId: 'req-int',
      },
    });
    await owner.adminActivity.create({
      data: {
        kind: 'CORRECTION_SUBMITTED',
        audience: 'ALL',
        title: 'New correction',
        preview: 'COR-00000001 · phone',
        entityType: 'CORRECTION',
        entityId: office.id,
      },
    });
    await owner.adminActivity.create({
      data: {
        kind: 'INVITE_ACCEPTED',
        audience: 'SUPER_ADMIN',
        title: 'Invite accepted',
        preview: 'A new admin set their password.',
        entityType: 'ADMIN_USER',
        entityId: admin.id,
      },
    });
  });

  afterAll(async () => {
    await server.close();
    await app.$disconnect();
    await owner.$disconnect();
  });

  it('returns the dashboard, search, and activity bell', async () => {
    const dashboard = await execute(
      'ADMIN_STAFF',
      `query { adminDashboard { offices pendingCorrections pilotCoverage { summary } recentlyEdited { actionLabel label } } }`,
    );
    expect(dashboard.body.errors, JSON.stringify(dashboard.body.errors)).toBeUndefined();
    const view = dashboard.body.data?.adminDashboard as {
      offices: number;
      pendingCorrections: number;
      pilotCoverage: { summary: string };
      recentlyEdited: { actionLabel: string; label: string }[];
    };
    expect(view.offices).toBe(1);
    expect(view.pendingCorrections).toBe(0);
    expect(view.pilotCoverage.summary).toBe('0 of 1 pilot jurisdictions fully covered');
    expect(view.recentlyEdited[0]).toMatchObject({ actionLabel: 'Created', label: 'Test office' });

    const found = await execute('ADMIN_STAFF', `query($q: String!) { adminSearch(q: $q) { offices { total items { label } } } }`, { q: 'Test' });
    expect(found.body.errors, JSON.stringify(found.body.errors)).toBeUndefined();
    const offices = found.body.data?.adminSearch as { offices: { total: number; items: { label: string }[] } };
    expect(offices.offices.total).toBe(1);
    expect(offices.offices.items[0]?.label).toBe('Test office');

    const short = await execute('ADMIN_STAFF', `query { adminSearch(q: "a") { offices { total } } }`);
    expectCode(short, 'VALIDATION');

    const staff = await execute('ADMIN_STAFF', `query { adminUnreadActivityCount adminActivity { totalCount edges { node { title unread } } } }`);
    expect(staff.body.errors, JSON.stringify(staff.body.errors)).toBeUndefined();
    const staffPage = staff.body.data as { adminUnreadActivityCount: number; adminActivity: { totalCount: number; edges: { node: { title: string } }[] } };
    expect(staffPage.adminUnreadActivityCount).toBe(1);
    expect(staffPage.adminActivity.totalCount).toBe(1);
    expect(staffPage.adminActivity.edges.map((edge) => edge.node.title)).toEqual(['New correction']);

    const marked = await execute('SUPER_ADMIN', `mutation { markAdminActivityRead(input: { all: true }) { updated } }`);
    expect(marked.body.errors, JSON.stringify(marked.body.errors)).toBeUndefined();
    expect((marked.body.data?.markAdminActivityRead as { updated: number }).updated).toBe(2);
    const unread = await execute('SUPER_ADMIN', `query { adminUnreadActivityCount }`);
    expect(unread.body.data?.adminUnreadActivityCount).toBe(0);
  });

  it('refuses a resident', async () => {
    const denied = await execute('Resident', `query { adminDashboard { offices } }`);
    expectCode(denied, 'FORBIDDEN');
  });
});
