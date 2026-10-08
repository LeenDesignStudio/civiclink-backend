import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { AppServices } from '../../app/services.js';
import { Authz, type Principal } from '../../authz/authz.js';
import { ROLE_PERMISSIONS, type Permission, type RoleName } from '../../authz/permissions.js';
import { withTx } from '../../db/prisma.js';
import type { ServiceContext } from '../../graphql/context.js';
import { buildServer } from '../../http/server.js';
import { MemoryRateGate } from '../../lib/rate-limit.js';
import { ValidationError } from '../../lib/errors.js';
import { AuditRepo } from '../audit/audit.repo.js';
import { AuditService } from '../audit/audit.service.js';
import { PipelineRepo } from '../pipeline/pipeline.repo.js';
import { DashboardRepo } from '../sources/dashboard.repo.js';
import { DashboardService } from '../sources/dashboard.js';
import { ExportService } from '../sources/export.js';
import { MemoryExportStore, PrismaExportReader } from '../sources/export.store.js';
import { SourcesService } from '../sources/sources.service.js';
import { CivicRepo } from './civic.repo.js';
import { CivicService, type AuditEntry } from './civic.service.js';
import { appDb, ownerDb, truncateAll } from '../../../test/setup/db.js';
import { expectCode, type GraphQLResult } from '../../../test/gql.js';
import {
  createAdminUser,
  createChangeLog,
  createJurisdiction,
  createOffice,
  createOfficeTerm,
  createOfficial,
  createPendingSourceChange,
  createService,
  createServiceCategory,
  createServiceLink,
  createSource,
  createSourceRun,
} from '../../../test/factories/index.js';

const USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SESSION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const WHEN = '2026-01-15T00:00:00.000Z';

const CALLERS = ['Resident', 'VIEWER', 'EDITOR', 'COMMUNICATIONS', 'SUPER_ADMIN'] as const satisfies readonly RoleName[];
type Caller = (typeof CALLERS)[number];

interface Fixture {
  sourceId: string;
  jurisdictionId: string;
  officeId: string;
  officialId: string;
  spareOfficialId: string;
  termId: string;
  categoryId: string;
  serviceId: string;
  pendingId: string;
}

interface Operation {
  name: string;
  permission: Permission;
  query: string;
  success: (fx: Fixture) => Record<string, unknown> | undefined;
  invalid: (fx: Fixture) => Record<string, unknown> | undefined;
  invalidCode?: 'VALIDATION' | 'BAD_REQUEST';
  check?: (value: unknown, fx: Fixture) => void;
}

function lacking(permission: Permission): Caller[] {
  return CALLERS.filter((role) => !ROLE_PERMISSIONS[role].includes(permission));
}

let adminId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function principal(role: Caller): Principal {
  if (role === 'Resident') {
    return { kind: 'resident', userId: USER_ID, status: 'ACTIVE', termsAccepted: true, sessionId: SESSION_ID };
  }
  return { kind: 'admin', adminId, role, sessionId: SESSION_ID };
}

function editorContext(): ServiceContext {
  const who = principal('EDITOR');
  return { requestId: 'req-int', principal: who, authz: new Authz(who), ipHash: 'hash' };
}

function operations(): Operation[] {
  const jurisdiction = {
    name: 'Integration County',
    level: 'COUNTY',
    type: 'COUNTY',
    lastUpdatedAt: WHEN,
  };
  const office = {
    name: 'Integration Clerk',
    selectionMethod: 'ELECTED',
    lastUpdatedAt: WHEN,
    notifyFollowers: false,
  };
  const official = { fullName: 'Ada Lovelace', lastUpdatedAt: WHEN, notifyFollowers: false };
  const service = {
    title: 'Permit desk',
    description: 'How to apply for a building permit.',
    lastValidatedAt: WHEN,
  };
  const source = {
    name: 'Integration source',
    publisher: 'CivicLink tests',
    url: 'https://example.com/source',
    termsUrl: 'https://example.com/terms',
    method: 'MANUAL',
    schedule: 'ON_DEMAND',
    freshnessDays: 30,
    levels: ['COUNTY'],
    active: true,
  };
  return [
    {
      name: 'adminDashboardCounts',
      permission: 'admin.dashboard:read',
      query: 'query { adminDashboardCounts { failedSourceRuns pendingSourceChanges } }',
      success: () => undefined,
      invalid: () => undefined,
      invalidCode: 'BAD_REQUEST',
    },
    {
      name: 'adminJurisdictions',
      permission: 'admin.civic:read',
      query: 'query($filter: AdminJurisdictionFilter, $sort: AdminCivicSort) { adminJurisdictions(filter: $filter, sort: $sort) { totalCount edges { node { id sourceRecordUrl } } } }',
      success: () => ({ sort: 'NAME' }),
      invalid: () => ({ filter: { state: 'Texas' } }),
      check: (value) => {
        const page = value as { totalCount: number; edges: { node: { sourceRecordUrl: string | null } }[] };
        expect(page.totalCount).toBeGreaterThan(0);
        expect(page.edges[0]?.node.sourceRecordUrl).toBe('https://example.com/jurisdiction');
      },
    },
    {
      name: 'adminJurisdiction',
      permission: 'admin.civic:read',
      query: 'query($id: ID!) { adminJurisdiction(id: $id) { id sourceRecordUrl } }',
      success: (fx) => ({ id: fx.jurisdictionId }),
      invalid: () => undefined,
      invalidCode: 'BAD_REQUEST',
      check: (value) => expect((value as { sourceRecordUrl: string }).sourceRecordUrl).toBe('https://example.com/jurisdiction'),
    },
    {
      name: 'upsertJurisdiction',
      permission: 'admin.civic:write',
      query: 'mutation($input: UpsertJurisdictionInput!) { upsertJurisdiction(input: $input) { id name sourceRecordUrl } }',
      success: (fx) => ({
        input: {
          ...jurisdiction,
          parentId: fx.jurisdictionId,
          sourceId: fx.sourceId,
          sourceRecordUrl: 'https://example.com/new-jurisdiction',
        },
      }),
      invalid: (fx) => ({ input: { ...jurisdiction, name: 'x', sourceId: fx.sourceId } }),
    },
    {
      name: 'retireJurisdiction',
      permission: 'admin.civic:retire',
      query: 'mutation($id: ID!, $retireActiveOffices: Boolean) { retireJurisdiction(id: $id, retireActiveOffices: $retireActiveOffices) { id status } }',
      success: (fx) => ({ id: fx.jurisdictionId, retireActiveOffices: true }),
      invalid: () => ({ id: 'not-a-uuid' }),
    },
    {
      name: 'restoreJurisdiction',
      permission: 'admin.civic:retire',
      query: 'mutation($id: ID!) { restoreJurisdiction(id: $id) { id status } }',
      success: (fx) => ({ id: fx.jurisdictionId }),
      invalid: () => ({ id: 'not-a-uuid' }),
    },
    {
      name: 'adminOffices',
      permission: 'admin.civic:read',
      query: 'query($filter: AdminOfficeFilter) { adminOffices(filter: $filter) { totalCount edges { node { id name } } } }',
      success: () => ({}),
      invalid: () => ({ filter: { jurisdictionId: 'not-a-uuid' } }),
      check: (value) => expect((value as { totalCount: number }).totalCount).toBeGreaterThan(0),
    },
    {
      name: 'adminOffice',
      permission: 'admin.civic:read',
      query: 'query($id: ID!) { adminOffice(id: $id) { id name } }',
      success: (fx) => ({ id: fx.officeId }),
      invalid: () => undefined,
      invalidCode: 'BAD_REQUEST',
    },
    {
      name: 'upsertOffice',
      permission: 'admin.civic:write',
      query: 'mutation($input: UpsertOfficeInput!) { upsertOffice(input: $input) { id name } }',
      success: (fx) => ({ input: { ...office, jurisdictionId: fx.jurisdictionId, sourceId: fx.sourceId } }),
      invalid: (fx) => ({ input: { ...office, name: 'x', jurisdictionId: fx.jurisdictionId, sourceId: fx.sourceId } }),
    },
    {
      name: 'retireOffice',
      permission: 'admin.civic:retire',
      query: 'mutation($id: ID!) { retireOffice(id: $id) { id status } }',
      success: (fx) => ({ id: fx.officeId }),
      invalid: () => ({ id: 'not-a-uuid' }),
    },
    {
      name: 'restoreOffice',
      permission: 'admin.civic:retire',
      query: 'mutation($id: ID!) { restoreOffice(id: $id) { id status } }',
      success: (fx) => ({ id: fx.officeId }),
      invalid: () => ({ id: 'not-a-uuid' }),
    },
    {
      name: 'adminOfficials',
      permission: 'admin.civic:read',
      query: 'query($filter: AdminOfficialFilter) { adminOfficials(filter: $filter) { totalCount edges { node { id terms { id isCurrent } } } } }',
      success: () => undefined,
      invalid: () => ({ filter: { officeId: 'not-a-uuid' } }),
      check: (value, fx) => {
        const page = value as { totalCount: number; edges: { node: { id: string; terms: { id: string }[] } }[] };
        expect(page.totalCount).toBeGreaterThan(0);
        expect(page.edges.find((edge) => edge.node.id === fx.officialId)?.node.terms[0]?.id).toBe(fx.termId);
      },
    },
    {
      name: 'adminOfficial',
      permission: 'admin.civic:read',
      query: 'query($id: ID!) { adminOfficial(id: $id) { id terms { id } } }',
      success: (fx) => ({ id: fx.officialId }),
      invalid: () => undefined,
      invalidCode: 'BAD_REQUEST',
      check: (value, fx) => expect((value as { terms: { id: string }[] }).terms[0]?.id).toBe(fx.termId),
    },
    {
      name: 'upsertOfficial',
      permission: 'admin.civic:write',
      query: 'mutation($input: UpsertOfficialInput!) { upsertOfficial(input: $input) { id fullName } }',
      success: (fx) => ({ input: { ...official, sourceId: fx.sourceId } }),
      invalid: (fx) => ({ input: { ...official, fullName: 'x', sourceId: fx.sourceId } }),
    },
    {
      name: 'setOfficeTerm',
      permission: 'admin.civic:write',
      query: 'mutation($input: SetOfficeTermInput!) { setOfficeTerm(input: $input) { term { id officeId } office { id name } } }',
      success: (fx) => ({
        input: { officeId: fx.officeId, officialId: fx.officialId, status: 'ELECTED', makeCurrent: false },
      }),
      invalid: (fx) => ({
        input: {
          officeId: fx.officeId,
          officialId: fx.officialId,
          status: 'ELECTED',
          makeCurrent: false,
          termStart: '2026-06-01T00:00:00.000Z',
          termEnd: '2026-01-01T00:00:00.000Z',
        },
      }),
      check: (value, fx) => {
        const payload = value as { term: { officeId: string }; office: { id: string; name: string } };
        expect(payload.term.officeId).toBe(fx.officeId);
        expect(payload.office.id).toBe(fx.officeId);
        expect(payload.office.name).toBeTruthy();
      },
    },
    {
      name: 'endOfficeTerm',
      permission: 'admin.civic:write',
      query: 'mutation($input: EndOfficeTermInput!) { endOfficeTerm(input: $input) { term { id isCurrent } office { id } } }',
      success: (fx) => ({ input: { termId: fx.termId, termEnd: WHEN } }),
      invalid: () => ({ input: { termId: 'not-a-uuid' } }),
      check: (value, fx) => {
        const payload = value as { term: { isCurrent: boolean }; office: { id: string } };
        expect(payload.term.isCurrent).toBe(false);
        expect(payload.office.id).toBe(fx.officeId);
      },
    },
    {
      name: 'retireOfficial',
      permission: 'admin.civic:retire',
      query: 'mutation($id: ID!) { retireOfficial(id: $id) { id status } }',
      success: (fx) => ({ id: fx.spareOfficialId }),
      invalid: () => ({ id: 'not-a-uuid' }),
    },
    {
      name: 'restoreOfficial',
      permission: 'admin.civic:retire',
      query: 'mutation($id: ID!) { restoreOfficial(id: $id) { id status } }',
      success: (fx) => ({ id: fx.spareOfficialId }),
      invalid: () => ({ id: 'not-a-uuid' }),
    },
    {
      name: 'adminServices',
      permission: 'admin.civic:read',
      query: 'query($filter: AdminServiceFilter) { adminServices(filter: $filter) { totalCount edges { node { id links { jurisdictionId } } } } }',
      success: () => undefined,
      invalid: () => ({ filter: { categoryId: 'not-a-uuid' } }),
      check: (value, fx) => {
        const page = value as { totalCount: number; edges: { node: { links: { jurisdictionId: string }[] } }[] };
        expect(page.totalCount).toBeGreaterThan(0);
        expect(page.edges[0]?.node.links[0]?.jurisdictionId).toBe(fx.jurisdictionId);
      },
    },
    {
      name: 'adminService',
      permission: 'admin.civic:read',
      query: 'query($id: ID!) { adminService(id: $id) { id links { id } } }',
      success: (fx) => ({ id: fx.serviceId }),
      invalid: () => undefined,
      invalidCode: 'BAD_REQUEST',
      check: (value) => expect((value as { links: unknown[] }).links.length).toBeGreaterThan(0),
    },
    {
      name: 'upsertService',
      permission: 'admin.civic:write',
      query: 'mutation($input: UpsertServiceInput!) { upsertService(input: $input) { id title } }',
      success: (fx) => ({
        input: {
          ...service,
          categoryId: fx.categoryId,
          sourceId: fx.sourceId,
          url: 'https://example.com/permits',
          jurisdictionIds: [fx.jurisdictionId],
        },
      }),
      invalid: (fx) => ({ input: { ...service, title: 'x', categoryId: fx.categoryId, sourceId: fx.sourceId } }),
    },
    {
      name: 'retireService',
      permission: 'admin.civic:retire',
      query: 'mutation($id: ID!) { retireService(id: $id) { id status } }',
      success: (fx) => ({ id: fx.serviceId }),
      invalid: () => ({ id: 'not-a-uuid' }),
    },
    {
      name: 'restoreService',
      permission: 'admin.civic:retire',
      query: 'mutation($id: ID!) { restoreService(id: $id) { id status } }',
      success: (fx) => ({ id: fx.serviceId }),
      invalid: () => ({ id: 'not-a-uuid' }),
    },
    {
      name: 'upsertServiceCategory',
      permission: 'admin.civic:write',
      query: 'mutation($input: UpsertServiceCategoryInput!) { upsertServiceCategory(input: $input) { id name } }',
      success: () => ({ input: { name: 'Permits' } }),
      invalid: () => ({ input: { name: 'x' } }),
    },
    {
      name: 'adminSources',
      permission: 'admin.civic:read',
      query: 'query($first: Int) { adminSources(first: $first) { totalCount edges { node { id } } } }',
      success: () => ({ first: 5 }),
      invalid: () => ({ first: 0 }),
      check: (value) => expect((value as { totalCount: number }).totalCount).toBeGreaterThan(0),
    },
    {
      name: 'adminSource',
      permission: 'admin.civic:read',
      query: 'query($id: UUID!) { adminSource(id: $id) { source { id } } }',
      success: (fx) => ({ id: fx.sourceId }),
      invalid: () => undefined,
      invalidCode: 'BAD_REQUEST',
    },
    {
      name: 'upsertSource',
      permission: 'admin.source:write',
      query: 'mutation($input: UpsertSourceInput!) { upsertSource(input: $input) { source { id name } } }',
      success: () => ({ input: source }),
      invalid: () => ({ input: { ...source, freshnessDays: 0 } }),
    },
    {
      name: 'triggerSourceRefresh',
      permission: 'admin.source:run',
      query: 'mutation($input: TriggerSourceRefreshInput!) { triggerSourceRefresh(input: $input) { run { id status } } }',
      success: (fx) => ({ input: { sourceId: fx.sourceId } }),
      invalid: () => undefined,
      invalidCode: 'BAD_REQUEST',
    },
    {
      name: 'pendingSourceChanges',
      permission: 'admin.civic:read',
      query: 'query($first: Int) { pendingSourceChanges(first: $first) { id decision } }',
      success: () => ({ first: 5 }),
      invalid: () => ({ first: 0 }),
    },
    {
      name: 'decideSourceChange',
      permission: 'admin.source:decide',
      query: 'mutation($input: DecideSourceChangeInput!) { decideSourceChange(input: $input) { change { id decision } } }',
      success: (fx) => ({ input: { id: fx.pendingId, decision: 'REJECTED' } }),
      invalid: (fx) => ({ input: { id: fx.pendingId, decision: 'PENDING' } }),
    },
    {
      name: 'changeLog',
      permission: 'admin.changelog:read',
      query: 'query($entityType: String!, $entityId: UUID!) { changeLog(entityType: $entityType, entityId: $entityId) { totalCount edges { node { id } } } }',
      success: (fx) => ({ entityType: 'office', entityId: fx.officeId }),
      invalid: (fx) => ({ entityType: ' ', entityId: fx.officeId }),
      check: (value) => expect((value as { totalCount: number }).totalCount).toBeGreaterThan(0),
    },
    {
      name: 'exportCsv',
      permission: 'admin.export:csv',
      query: 'mutation($input: ExportCsvInput!) { exportCsv(input: $input) { url } }',
      success: () => ({ input: { list: 'OFFICES' } }),
      invalid: () => ({ input: { list: 'OFFICES', filter: '{' } }),
    },
  ];
}

const documentInvalid: Record<string, string> = {
  adminDashboardCounts: 'query { adminDashboardCounts(nope: true) { failedSourceRuns } }',
  adminJurisdiction: 'query { adminJurisdiction { id } }',
  adminOffice: 'query { adminOffice { id } }',
  adminOfficial: 'query { adminOfficial { id } }',
  adminService: 'query { adminService { id } }',
  adminSource: 'query { adminSource { id } }',
  triggerSourceRefresh: 'mutation { triggerSourceRefresh { run { id } } }',
};

describe('section H admin civic API', () => {
  let app: PrismaClient;
  let owner: PrismaClient;
  let server: FastifyInstance;
  let sources: SourcesService;
  let current: Principal = principal('EDITOR');
  let fx: Fixture;

  beforeAll(async () => {
    app = appDb();
    owner = ownerDb();
    const auditRepo = new AuditRepo(app);
    const record = (tx: unknown, entry: AuditEntry) => auditRepo.insert(tx, entry);
    const civic = new CivicService({
      repo: new CivicRepo(app, app),
      lookups: { findActive: () => Promise.resolve(null) },
      clock: { now: () => new Date(WHEN) },
      audit: { record },
      enqueue: () => Promise.resolve(),
    });
    sources = new SourcesService({
      store: new PipelineRepo(app),
      audit: { record },
      enqueue: { enqueue: () => Promise.resolve() },
      dashboard: new DashboardService(new DashboardRepo(app)),
      withTx: (fn) => withTx(fn, { client: app }),
    });
    const services = {
      civic,
      audit: new AuditService(auditRepo),
      sources,
      exports: new ExportService({
        reader: new PrismaExportReader(app),
        store: new MemoryExportStore(),
        audit: { record },
        withTx: (fn) => withTx(fn, { client: app }),
      }),
    } as AppServices;
    server = await buildServer({
      services,
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
    const jurisdiction = await createJurisdiction(owner, source.id, { name: 'Seed County', type: 'COUNTY', level: 'COUNTY' });
    await owner.jurisdiction.update({
      where: { id: jurisdiction.id },
      data: { sourceRecordUrl: 'https://example.com/jurisdiction' },
    });
    const office = await createOffice(owner, jurisdiction.id, source.id);
    const official = await createOfficial(owner, source.id);
    const spare = await createOfficial(owner, source.id);
    const term = await createOfficeTerm(owner, office.id, official.id);
    const category = await createServiceCategory(owner);
    const service = await createService(owner, category.id, source.id);
    await createServiceLink(owner, service.id, jurisdiction.id);
    const run = await createSourceRun(owner, source.id);
    const pending = await createPendingSourceChange(owner, run.id);
    await createChangeLog(owner, office.id);
    fx = {
      sourceId: source.id,
      jurisdictionId: jurisdiction.id,
      officeId: office.id,
      officialId: official.id,
      spareOfficialId: spare.id,
      termId: term.id,
      categoryId: category.id,
      serviceId: service.id,
      pendingId: pending.id,
    };
  });

  afterAll(async () => {
    await server.close();
    await app.$disconnect();
    await owner.$disconnect();
  });

  async function execute(role: Caller, query: string, variables?: Record<string, unknown>): Promise<GraphQLResult> {
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

  for (const operation of operations()) {
    it(`${operation.name} succeeds for an editor`, async () => {
      const variables = operation.success(fx);
      const result = await execute('EDITOR', operation.query, variables);
      expect(result.body.errors, JSON.stringify(result.body.errors)).toBeUndefined();
      const value = result.body.data?.[operation.name];
      expect(value).toBeTruthy();
      operation.check?.(value, fx);
    });

    it(`${operation.name} denies every role without ${operation.permission}`, async () => {
      const variables = operation.success(fx);
      const denied = lacking(operation.permission);
      expect(denied.length).toBeGreaterThan(0);
      for (const role of denied) {
        const result = await execute(role, operation.query, variables);
        expectCode(result, 'FORBIDDEN');
      }
    });

    it(`${operation.name} rejects invalid input`, async () => {
      if (operation.name === 'adminSource') {
        await expect(sources.adminSource(editorContext(), { sourceId: 'not-a-uuid' })).rejects.toBeInstanceOf(ValidationError);
        return;
      }
      if (operation.name === 'triggerSourceRefresh') {
        await expect(sources.triggerSourceRefresh(editorContext(), { sourceId: 'not-a-uuid' })).rejects.toBeInstanceOf(ValidationError);
        return;
      }
      const query = operation.invalidCode === 'BAD_REQUEST' ? (documentInvalid[operation.name] ?? operation.query) : operation.query;
      const variables = operation.invalidCode === 'BAD_REQUEST' ? undefined : operation.invalid(fx);
      const result = await execute('EDITOR', query, variables);
      expectCode(result, operation.invalidCode ?? 'VALIDATION');
    });
  }
});
