import { z } from 'zod';
import type { ServiceContext } from '../../graphql/context.js';
import type { Clock } from '../../lib/clock.js';
import { fromZod } from '../../lib/errors.js';
import {
  ConflictError,
  HasActiveChildrenError,
  HasCurrentTermError,
  JurisdictionCycleError,
  LookupNotFoundError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors.js';
import { buildConnection, clampFirst, decodeCursor, encodeCursor, type Connection } from '../../lib/pagination.js';
import { slugify } from '../../lib/slug.js';
import type {
  AdminJurisdictionNode,
  AdminOfficeRecord,
  AdminOfficialRecord,
  AdminServiceRecord,
  Freshness,
  FreshnessOverride,
  GovLevel,
  JurisdictionBrief,
  JurisdictionRecord,
  JurisdictionType,
  OfficeProfile,
  OfficeRecord,
  OfficialProfile,
  OfficialRecord,
  PlanDto,
  LegalVersionDto,
  ServiceCategoryDto,
  ServiceCategoryRecord,
  ServiceDto,
  ServicePreview,
  ServiceRecord,
  TermStatus,
} from './civic.dto.js';
import type { AdminCursor, AdminSort, CivicStore, ListServicesArgs } from './civic.repo.js';
import {
  adminJurisdictionListSchema,
  adminOfficeListSchema,
  adminOfficialListSchema,
  adminServiceListSchema,
  parseEndOfficeTerm,
  parseId,
  parseOfficeQuery,
  parseOfficialQuery,
  parseRetireJurisdiction,
  parseServicesQuery,
  parseSetOfficeTerm,
  parseUpsertJurisdiction,
  parseUpsertOffice,
  parseUpsertOfficial,
  parseUpsertService,
  parseUpsertServiceCategory,
} from './civic.inputs.js';
import type { LookupContext } from '../lookup/lookup.dto.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw fromZod(parsed.error);
  return parsed.data;
}

const DEFAULT_WHY: Record<JurisdictionType, string> = {
  NATION: '{office} serves {jurisdiction} ({district}).',
  STATE: '{office} serves the state of {jurisdiction} ({district}).',
  CONGRESSIONAL_DISTRICT: '{office} represents {jurisdiction}, district {district}.',
  STATE_SENATE_DISTRICT: '{office} represents {jurisdiction} in the state senate, district {district}.',
  STATE_HOUSE_DISTRICT: '{office} represents {jurisdiction} in the state house, district {district}.',
  COUNTY: '{office} serves {jurisdiction} ({district}).',
  COUNTY_COUNCIL_DISTRICT: '{office} represents {jurisdiction}, district {district}.',
  MUNICIPALITY: '{office} serves the city of {jurisdiction} ({district}).',
  WARD: '{office} represents {jurisdiction}, ward {district}.',
  SCHOOL_DISTRICT: '{office} serves the {jurisdiction} schools ({district}).',
  SCHOOL_BOARD_DISTRICT: '{office} represents {jurisdiction} on the school board, district {district}.',
  COMMUNITY_COLLEGE_DISTRICT: '{office} serves {jurisdiction} ({district}).',
  SPECIAL_DISTRICT: '{office} serves the {jurisdiction} district ({district}).',
  ZCTA: '{office} applies within {jurisdiction} ({district}).',
};

export interface AuditEntry {
  actorType: 'RESIDENT' | 'ADMIN' | 'SYSTEM' | 'SOURCE';
  actorId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  requestId: string | null;
}

export interface AuditRecorder {
  record(tx: unknown, entry: AuditEntry): Promise<void>;
}

export const noopAudit: AuditRecorder = {
  async record() {
    return undefined;
  },
};

export interface LookupReader {
  findActive(token: string, now: Date): Promise<LookupContext | null>;
}

export interface CivicReadPort {
  jurisdictionBriefs(ids: string[]): Promise<JurisdictionBrief[]>;
  officesForJurisdictions(ids: string[]): Promise<OfficeRecord[]>;
  servicesForLinks(jurisdictionIds: string[], officeIds: string[], limit: number): Promise<ServiceRecord[]>;
}

export interface CivicServiceDeps {
  repo: CivicStore;
  lookups: LookupReader;
  clock: Clock;
  audit?: AuditRecorder;
  enqueue?: (job: string, payload: Record<string, unknown>) => Promise<void>;
}

export function computeFreshness(
  override: FreshnessOverride,
  lastUpdatedAt: Date,
  freshnessDays: number,
  now: Date,
): Freshness {
  if (override === 'FORCE_CURRENT') return 'CURRENT';
  if (override === 'FORCE_OUTDATED') return 'MAY_BE_OUTDATED';
  const age = now.getTime() - lastUpdatedAt.getTime();
  return age <= freshnessDays * MS_PER_DAY ? 'CURRENT' : 'MAY_BE_OUTDATED';
}

export function formatList(names: string[]): string {
  if (names.length === 0) return '';
  const first = names[0] ?? '';
  if (names.length === 1) return first;
  const second = names[1] ?? '';
  if (names.length === 2) return `${first} and ${second}`;
  const last = names[names.length - 1] ?? '';
  return `${names.slice(0, -1).join(', ')}, and ${last}`;
}

export function renderWhyItApplies(input: {
  officeName: string;
  whyTemplate: string | null;
  jurisdictionId: string;
  jurisdictionName: string;
  jurisdictionType: JurisdictionType;
  jurisdictionLevel: GovLevel;
  districtCode: string | null;
  lookup: LookupContext | null;
}): string | null {
  if (!input.lookup) return null;
  const listed = input.lookup.jurisdictionIds.includes(input.jurisdictionId)
    || input.lookup.levels.some((level) => level.members.some((member) => member.id === input.jurisdictionId));
  if (!listed) return null;
  const level = input.lookup.levels.find((entry) => entry.level === input.jurisdictionLevel);
  if (level?.confidence === 'MULTIPLE') {
    const sameType = level.members.filter((member) => member.type === input.jurisdictionType);
    const names = (sameType.length > 1 ? sameType : level.members).map((member) => member.name);
    return `Your ZIP code overlaps ${formatList(names)}.`;
  }
  const template = input.whyTemplate ?? DEFAULT_WHY[input.jurisdictionType];
  return template.replace(/\{(jurisdiction|office|district)\}/g, (_match, key: string) => {
    if (key === 'jurisdiction') return input.jurisdictionName;
    if (key === 'office') return input.officeName;
    return input.districtCode ?? '';
  });
}

export function toPublicOffice(record: OfficeRecord, now: Date, lookup: LookupContext | null): OfficeProfile {
  const holder = record.currentTerm?.official.status === 'ACTIVE' ? record.currentTerm : null;
  let holderUnknown = false;
  let vacant = false;
  let currentHolder: OfficeProfile['currentHolder'] = null;
  let termStatus: TermStatus | null = null;
  if (holder) {
    currentHolder = {
      id: holder.official.id,
      slug: holder.official.slug,
      fullName: holder.official.fullName,
      displayName: holder.official.displayName,
      party: holder.official.party,
      photoUrl: holder.official.photoUrl,
    };
    termStatus = holder.status;
  } else if (record.holderUnknown) {
    holderUnknown = true;
  } else {
    vacant = true;
  }
  return {
    id: record.id,
    slug: record.slug,
    name: record.name,
    seatLabel: record.seatLabel,
    selectionMethod: record.selectionMethod,
    displayOrder: record.displayOrder,
    phone: record.phone,
    email: record.email,
    website: record.website,
    contactUrl: record.contactUrl,
    holderUnknown,
    vacant,
    currentHolder,
    termStatus,
    addresses: record.addresses,
    jurisdiction: record.jurisdiction,
    source: { name: record.source.name, url: record.source.url },
    lastUpdatedAt: record.lastUpdatedAt,
    freshness: computeFreshness(
      record.freshnessOverride,
      record.lastUpdatedAt,
      record.source.freshnessDays,
      now,
    ),
    whyItApplies: renderWhyItApplies({
      officeName: record.name,
      whyTemplate: record.whyTemplate,
      jurisdictionId: record.jurisdiction.id,
      jurisdictionName: record.jurisdiction.name,
      jurisdictionType: record.jurisdiction.type,
      jurisdictionLevel: record.jurisdiction.level,
      districtCode: record.jurisdiction.districtCode,
      lookup,
    }),
    isFollowed: null,
  };
}

export function toServicePreview(record: ServiceRecord): ServicePreview {
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    url: record.url,
    phoneContact: record.phoneContact,
    category: { id: record.category.id, name: record.category.name },
  };
}

function redirectOfficeSlug(official: OfficialRecord): string | null {
  const currentActive = official.terms.find((term) => term.isCurrent && term.office.status === 'ACTIVE');
  if (official.status === 'ACTIVE' && currentActive) return null;
  const preferred = official.terms.find((term) => term.office.status === 'ACTIVE') ?? official.terms[0];
  return preferred?.office.slug ?? null;
}

export class CivicService {
  private readonly repo: CivicStore;
  private readonly lookups: LookupReader;
  private readonly clock: Clock;
  private readonly auditLog: AuditRecorder;
  private readonly enqueue?: (job: string, payload: Record<string, unknown>) => Promise<void>;

  constructor(deps: CivicServiceDeps) {
    this.repo = deps.repo;
    this.lookups = deps.lookups;
    this.clock = deps.clock;
    this.auditLog = deps.audit ?? noopAudit;
    if (deps.enqueue) this.enqueue = deps.enqueue;
  }

  async getOffice(ctx: ServiceContext, input: unknown): Promise<OfficeProfile> {
    ctx.authz.require('public.civic:read');
    const query = parseOfficeQuery(input);
    const office = await this.repo.findOfficeBySlug(query.slug);
    if (!office || office.status !== 'ACTIVE') throw new NotFoundError();
    const lookup = query.lookupToken
      ? await this.lookups.findActive(query.lookupToken, this.clock.now())
      : null;
    return toPublicOffice(office, this.clock.now(), lookup);
  }

  async getOfficial(ctx: ServiceContext, input: unknown): Promise<OfficialProfile> {
    ctx.authz.require('public.civic:read');
    const query = parseOfficialQuery(input);
    const official = await this.repo.findOfficialBySlug(query.slug);
    if (!official) throw new NotFoundError();
    const now = this.clock.now();
    const lookup = query.lookupToken ? await this.lookups.findActive(query.lookupToken, now) : null;
    const redirect = redirectOfficeSlug(official);
    const current = official.terms.find(
      (term) => official.status === 'ACTIVE' && term.isCurrent && term.office.status === 'ACTIVE',
    );
    return {
      id: official.id,
      slug: official.slug,
      fullName: official.fullName,
      displayName: official.displayName,
      party: official.party,
      photoUrl: official.photoUrl,
      website: official.website,
      source: { name: official.source.name, url: official.source.url },
      lastUpdatedAt: official.lastUpdatedAt,
      freshness: computeFreshness(
        official.freshnessOverride,
        official.lastUpdatedAt,
        official.source.freshnessDays,
        now,
      ),
      redirectOfficeSlug: redirect,
      whyItApplies: current
        ? renderWhyItApplies({
            officeName: current.office.name,
            whyTemplate: current.office.whyTemplate,
            jurisdictionId: current.office.jurisdiction.id,
            jurisdictionName: current.office.jurisdiction.name,
            jurisdictionType: current.office.jurisdiction.type,
            jurisdictionLevel: current.office.jurisdiction.level,
            districtCode: current.office.jurisdiction.districtCode,
            lookup,
          })
        : null,
    };
  }

  async listServices(ctx: ServiceContext, input: unknown): Promise<Connection<ServiceDto>> {
    ctx.authz.require('public.civic:read');
    const query = parseServicesQuery(input);
    const first = clampFirst(query.first);
    let jurisdictionIds: string[] = [];
    let officeIds: string[] = [];
    if (query.lookupToken) {
      const lookup = await this.lookups.findActive(query.lookupToken, this.clock.now());
      if (!lookup) throw new LookupNotFoundError();
      jurisdictionIds = lookup.jurisdictionIds;
      const offices = await this.repo.officesForJurisdictions(jurisdictionIds);
      officeIds = offices.map((office) => office.id);
    } else if (query.jurisdictionId) {
      jurisdictionIds = [query.jurisdictionId];
    } else if (query.officeId) {
      officeIds = [query.officeId];
    }
    const after = query.after ? decodeCursor(query.after) : undefined;
    if (query.after && !after) {
      throw new ValidationError('That page cursor is not valid.', [
        { path: 'after', code: 'custom', message: 'That page cursor is not valid.' },
      ]);
    }
    const args: ListServicesArgs = { jurisdictionIds, officeIds, first };
    if (query.categoryId) args.categoryId = query.categoryId;
    if (after) args.after = after;
    const rows = await this.repo.listServices(args);
    const nodes: ServiceDto[] = rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      url: row.url,
      phoneContact: row.phoneContact,
      category: row.category,
      createdAt: row.createdAt,
    }));
    return buildConnection(nodes, first);
  }

  async listServiceCategories(ctx: ServiceContext): Promise<ServiceCategoryDto[]> {
    ctx.authz.require('public.civic:read');
    const rows = await this.repo.listActiveCategories();
    return rows.map((row) => ({ id: row.id, name: row.name, sortOrder: row.sortOrder }));
  }

  async listPlans(ctx: ServiceContext): Promise<PlanDto[]> {
    ctx.authz.require('public.plans:read');
    return this.repo.listActivePlans();
  }

  async listLegalVersions(ctx: ServiceContext): Promise<LegalVersionDto[]> {
    ctx.authz.require('public.legal:read');
    return this.repo.listCurrentLegal();
  }

  async adminJurisdiction(ctx: ServiceContext, id: string): Promise<JurisdictionRecord> {
    ctx.authz.require('admin.civic:read');
    const row = await this.repo.findJurisdiction(id);
    if (!row) throw new NotFoundError();
    return row;
  }

  async adminOffice(ctx: ServiceContext, id: string): Promise<AdminOfficeRecord> {
    ctx.authz.require('admin.civic:read');
    const row = await this.repo.findAdminOffice(id);
    if (!row) throw new NotFoundError();
    return row;
  }

  async adminOfficial(ctx: ServiceContext, id: string): Promise<AdminOfficialRecord> {
    ctx.authz.require('admin.civic:read');
    const row = await this.repo.findAdminOfficial(id);
    if (!row) throw new NotFoundError();
    return row;
  }

  async adminService(ctx: ServiceContext, id: string): Promise<AdminServiceRecord> {
    ctx.authz.require('admin.civic:read');
    const row = await this.repo.findAdminService(id);
    if (!row) throw new NotFoundError();
    return row;
  }

  adminJurisdictions(ctx: ServiceContext, input: unknown): Promise<Connection<AdminJurisdictionNode>> {
    ctx.authz.require('admin.civic:read');
    const parsed = parse(adminJurisdictionListSchema, input);
    const filter = parsed.filter ?? {};
    return this.page(parsed.first, parsed.after, parsed.sort, (query) =>
      this.repo.listAdminJurisdictions({
        ...query,
        freshnessCutoff: this.freshnessCutoff(),
        ...(filter.level ? { level: filter.level } : {}),
        ...(filter.type ? { type: filter.type } : {}),
        ...(filter.state ? { state: filter.state } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.freshness ? { freshness: filter.freshness } : {}),
        ...(filter.q ? { q: filter.q } : {}),
      }),
    );
  }

  adminOffices(ctx: ServiceContext, input: unknown): Promise<Connection<AdminOfficeRecord & { createdAt: Date }>> {
    ctx.authz.require('admin.civic:read');
    const parsed = parse(adminOfficeListSchema, input);
    const filter = parsed.filter ?? {};
    return this.page(parsed.first, parsed.after, parsed.sort, (query) =>
      this.repo.listAdminOffices({
        ...query,
        freshnessCutoff: this.freshnessCutoff(),
        ...(filter.level ? { level: filter.level } : {}),
        ...(filter.jurisdictionId ? { jurisdictionId: filter.jurisdictionId } : {}),
        ...(filter.vacantOnly ? { vacantOnly: filter.vacantOnly } : {}),
        ...(filter.staleOnly ? { staleOnly: filter.staleOnly } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.q ? { q: filter.q } : {}),
      }),
    );
  }

  adminOfficials(ctx: ServiceContext, input: unknown): Promise<Connection<AdminOfficialRecord & { createdAt: Date }>> {
    ctx.authz.require('admin.civic:read');
    const parsed = parse(adminOfficialListSchema, input);
    const filter = parsed.filter ?? {};
    return this.page(parsed.first, parsed.after, parsed.sort, (query) =>
      this.repo.listAdminOfficials({
        ...query,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.officeId ? { officeId: filter.officeId } : {}),
        ...(filter.q ? { q: filter.q } : {}),
      }),
    );
  }

  adminServices(ctx: ServiceContext, input: unknown): Promise<Connection<AdminServiceRecord & { createdAt: Date }>> {
    ctx.authz.require('admin.civic:read');
    const parsed = parse(adminServiceListSchema, input);
    const filter = parsed.filter ?? {};
    return this.page(parsed.first, parsed.after, parsed.sort, (query) =>
      this.repo.listAdminServices({
        ...query,
        ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.linkBroken !== undefined ? { linkBroken: filter.linkBroken } : {}),
        ...(filter.q ? { q: filter.q } : {}),
      }),
    );
  }

  upsertJurisdiction(ctx: ServiceContext, input: unknown): Promise<JurisdictionRecord> {
    ctx.authz.require('admin.civic:write');
    const parsed = parseUpsertJurisdiction(input);
    return this.repo.transaction(async (store, tx) => {
      if (!(await store.sourceExists(parsed.sourceId))) throw new NotFoundError();
      await this.assertParent(store, parsed.id, parsed.parentId, parsed.type);
      if (parsed.id) {
        const before = await store.findJurisdiction(parsed.id);
        if (!before) throw new NotFoundError();
        const after = await store.updateJurisdiction(parsed.id, parsed);
        await this.record(tx, ctx, 'JURISDICTION', after.id, 'UPDATE', snapshot(before), snapshot(after));
        return after;
      }
      const created = await store.createJurisdiction(parsed);
      await this.record(tx, ctx, 'JURISDICTION', created.id, 'CREATE', null, snapshot(created));
      return created;
    }, 'ReadCommitted');
  }

  retireJurisdiction(ctx: ServiceContext, input: unknown): Promise<{ id: string; status: 'RETIRED' }> {
    ctx.authz.require('admin.civic:retire');
    const parsed = parseRetireJurisdiction(input);
    return this.repo.transaction(async (store, tx) => {
      const current = await store.findJurisdiction(parsed.id);
      if (!current) throw new NotFoundError();
      const active = await store.countActiveOffices(parsed.id);
      if (active > 0 && !parsed.retireActiveOffices) throw new HasActiveChildrenError();
      const retiredOffices = parsed.retireActiveOffices ? await store.retireActiveOffices(parsed.id) : [];
      await store.setJurisdictionStatus(parsed.id, 'RETIRED');
      for (const officeId of retiredOffices) {
        await this.record(tx, ctx, 'OFFICE', officeId, 'RETIRE', { status: 'ACTIVE' }, { status: 'RETIRED' });
      }
      await this.record(
        tx,
        ctx,
        'JURISDICTION',
        parsed.id,
        'RETIRE',
        { status: current.status },
        { status: 'RETIRED' },
      );
      return { id: parsed.id, status: 'RETIRED' };
    }, 'ReadCommitted');
  }

  restoreJurisdiction(ctx: ServiceContext, input: unknown): Promise<{ id: string; status: 'ACTIVE' }> {
    ctx.authz.require('admin.civic:retire');
    const id = parseId(input);
    return this.repo.transaction(async (store, tx) => {
      const current = await store.findJurisdiction(id);
      if (!current) throw new NotFoundError();
      await store.setJurisdictionStatus(id, 'ACTIVE');
      await this.record(tx, ctx, 'JURISDICTION', id, 'RESTORE', { status: current.status }, { status: 'ACTIVE' });
      return { id, status: 'ACTIVE' };
    }, 'ReadCommitted');
  }

  async upsertOffice(ctx: ServiceContext, input: unknown): Promise<AdminOfficeRecord> {
    ctx.authz.require('admin.civic:write');
    const parsed = parseUpsertOffice(input);
    const saved = await this.repo.transaction(async (store, tx) => {
      if (!(await store.sourceExists(parsed.sourceId))) throw new NotFoundError();
      if (!(await store.findJurisdiction(parsed.jurisdictionId))) throw new NotFoundError();
      const before = parsed.id ? await store.findAdminOffice(parsed.id) : null;
      if (parsed.id && !before) throw new NotFoundError();
      const slug = await this.allocateSlug(store, 'office', parsed.name, parsed.id);
      const office = parsed.id
        ? await store.updateOffice(parsed.id, { ...parsed, slug })
        : await store.createOffice({ ...parsed, slug });
      await this.record(
        tx,
        ctx,
        'OFFICE',
        office.id,
        parsed.id ? 'UPDATE' : 'CREATE',
        before ? snapshot(before) : null,
        snapshot(office),
      );
      return { office, before };
    }, 'ReadCommitted');
    if (parsed.notifyFollowers && contactChanged(saved.before, saved.office)) {
      await this.notify({
        type: 'RECORD_UPDATE',
        entityType: 'OFFICE',
        entityId: saved.office.id,
        officeId: saved.office.id,
      });
    }
    return saved.office;
  }

  retireOffice(ctx: ServiceContext, input: unknown): Promise<{ id: string; status: 'RETIRED' }> {
    return this.setOfficeStatus(ctx, input, 'RETIRED');
  }

  restoreOffice(ctx: ServiceContext, input: unknown): Promise<{ id: string; status: 'ACTIVE' }> {
    return this.setOfficeStatus(ctx, input, 'ACTIVE');
  }

  async upsertOfficial(ctx: ServiceContext, input: unknown): Promise<AdminOfficialRecord> {
    ctx.authz.require('admin.civic:write');
    const parsed = parseUpsertOfficial(input);
    const saved = await this.repo.transaction(async (store, tx) => {
      if (!(await store.sourceExists(parsed.sourceId))) throw new NotFoundError();
      const before = parsed.id ? await store.findAdminOfficial(parsed.id) : null;
      if (parsed.id && !before) throw new NotFoundError();
      const slug = await this.allocateSlug(store, 'official', parsed.fullName, parsed.id);
      const official = parsed.id
        ? await store.updateOfficial(parsed.id, { ...parsed, slug })
        : await store.createOfficial({ ...parsed, slug });
      await this.record(
        tx,
        ctx,
        'OFFICIAL',
        official.id,
        parsed.id ? 'UPDATE' : 'CREATE',
        before ? snapshot(before) : null,
        snapshot(official),
      );
      return { official, before };
    }, 'ReadCommitted');
    if (parsed.notifyFollowers && officialChanged(saved.before, saved.official)) {
      await this.notify({
        type: 'RECORD_UPDATE',
        entityType: 'OFFICIAL',
        entityId: saved.official.id,
        officialId: saved.official.id,
      });
    }
    return saved.official;
  }

  async retireOfficial(ctx: ServiceContext, input: unknown): Promise<{ id: string; status: 'RETIRED' }> {
    ctx.authz.require('admin.civic:retire');
    const id = parseId(input);
    return this.repo.transaction(async (store, tx) => {
      const official = await store.findAdminOfficial(id);
      if (!official) throw new NotFoundError();
      if (await store.officialHasCurrentTerm(id)) throw new HasCurrentTermError();
      await store.setOfficialStatus(id, 'RETIRED');
      await this.record(tx, ctx, 'OFFICIAL', id, 'RETIRE', { status: official.status }, { status: 'RETIRED' });
      return { id, status: 'RETIRED' };
    }, 'ReadCommitted');
  }

  restoreOfficial(ctx: ServiceContext, input: unknown): Promise<{ id: string; status: 'ACTIVE' }> {
    ctx.authz.require('admin.civic:retire');
    const id = parseId(input);
    return this.repo.transaction(async (store, tx) => {
      const official = await store.findAdminOfficial(id);
      if (!official) throw new NotFoundError();
      await store.setOfficialStatus(id, 'ACTIVE');
      await this.record(tx, ctx, 'OFFICIAL', id, 'RESTORE', { status: official.status }, { status: 'ACTIVE' });
      return { id, status: 'ACTIVE' };
    }, 'ReadCommitted');
  }

  async setOfficeTerm(ctx: ServiceContext, input: unknown): Promise<{ id: string; officeId: string }> {
    ctx.authz.require('admin.civic:write');
    const parsed = parseSetOfficeTerm(input);
    const result = await this.repo.transaction(async (store, tx) => {
      const office = await store.findAdminOffice(parsed.officeId);
      if (!office) throw new NotFoundError();
      const official = await store.findAdminOfficial(parsed.officialId);
      if (!official) throw new NotFoundError();
      if (parsed.makeCurrent) {
        await store.endCurrentTerm(parsed.officeId, this.utcDay(this.clock.now()));
        await store.setHolderUnknown(parsed.officeId, false);
      }
      const term = await store.createTerm({
        officeId: parsed.officeId,
        officialId: parsed.officialId,
        status: parsed.status,
        termStart: parsed.termStart,
        termEnd: parsed.termEnd,
        isCurrent: parsed.makeCurrent,
      });
      await this.record(tx, ctx, 'OFFICE_TERM', term.id, 'CREATE', null, {
        officeId: parsed.officeId,
        officialId: parsed.officialId,
        status: parsed.status,
        isCurrent: parsed.makeCurrent,
      });
      return { term, office, official };
    }, 'Serializable');
    if (parsed.notifyFollowers && parsed.makeCurrent) {
      const name = result.official.displayName ?? result.official.fullName;
      await this.notify({
        type: 'RECORD_UPDATE',
        entityType: 'OFFICE',
        entityId: result.office.id,
        officeId: result.office.id,
        officialId: result.official.id,
        message: `${name} is now ${result.office.name}`,
      });
    }
    return { id: result.term.id, officeId: result.office.id };
  }

  endOfficeTerm(ctx: ServiceContext, input: unknown): Promise<{ id: string; officeId: string }> {
    ctx.authz.require('admin.civic:write');
    const parsed = parseEndOfficeTerm(input);
    return this.repo.transaction(async (store, tx) => {
      const term = await store.findTerm(parsed.termId);
      if (!term) throw new NotFoundError();
      const termEnd = parsed.termEnd ?? this.utcDay(this.clock.now());
      await store.endTerm(term.id, termEnd);
      await this.record(
        tx,
        ctx,
        'OFFICE_TERM',
        term.id,
        'UPDATE',
        { isCurrent: term.isCurrent },
        { isCurrent: false, termEnd: termEnd.toISOString() },
      );
      return { id: term.id, officeId: term.officeId };
    }, 'Serializable');
  }

  upsertService(ctx: ServiceContext, input: unknown): Promise<AdminServiceRecord> {
    ctx.authz.require('admin.civic:write');
    const parsed = parseUpsertService(input);
    return this.repo.transaction(async (store, tx) => {
      if (!(await store.sourceExists(parsed.sourceId))) throw new NotFoundError();
      if (!(await store.findCategoryById(parsed.categoryId))) throw new NotFoundError();
      const before = parsed.id ? await store.findAdminService(parsed.id) : null;
      if (parsed.id && !before) throw new NotFoundError();
      const service = parsed.id ? await store.updateService(parsed.id, parsed) : await store.createService(parsed);
      await this.record(
        tx,
        ctx,
        'SERVICE',
        service.id,
        parsed.id ? 'UPDATE' : 'CREATE',
        before ? snapshot(before) : null,
        snapshot(service),
      );
      return service;
    }, 'ReadCommitted');
  }

  retireService(ctx: ServiceContext, input: unknown): Promise<{ id: string; status: 'RETIRED' }> {
    return this.setServiceStatus(ctx, input, 'RETIRED');
  }

  restoreService(ctx: ServiceContext, input: unknown): Promise<{ id: string; status: 'ACTIVE' }> {
    return this.setServiceStatus(ctx, input, 'ACTIVE');
  }

  upsertServiceCategory(ctx: ServiceContext, input: unknown): Promise<ServiceCategoryRecord> {
    ctx.authz.require('admin.civic:write');
    const parsed = parseUpsertServiceCategory(input);
    return this.repo.transaction(async (store, tx) => {
      const named = await store.findCategoryByName(parsed.name);
      if (named && named.id !== parsed.id) throw new ConflictError();
      const before = parsed.id ? await store.findCategoryById(parsed.id) : null;
      if (parsed.id && !before) throw new NotFoundError();
      const category = parsed.id
        ? await store.updateCategory(parsed.id, parsed)
        : await store.createCategory(parsed);
      await this.record(
        tx,
        ctx,
        'SERVICE_CATEGORY',
        category.id,
        parsed.id ? 'UPDATE' : 'CREATE',
        before ? snapshot(before) : null,
        snapshot(category),
      );
      return category;
    }, 'ReadCommitted');
  }

  private freshnessCutoff(): Date {
    return new Date(this.clock.now().getTime() - 90 * MS_PER_DAY);
  }

  private async page<T extends { createdAt: Date; id: string; name?: string; fullName?: string; title?: string }>(
    first: number,
    after: string | undefined,
    sort: AdminSort,
    load: (query: { first: number; sort: AdminSort; after?: AdminCursor }) => Promise<{ rows: T[]; totalCount: number }>,
  ): Promise<Connection<T>> {
    const cursor = after ? decodeAdminCursor(after, sort) : undefined;
    if (after && !cursor) {
      throw new ValidationError('That page cursor is not valid.', [
        { path: 'after', code: 'custom', message: 'That page cursor is not valid.' },
      ]);
    }
    const loaded = await load({ first, sort, ...(cursor ? { after: cursor } : {}) });
    return adminConnection(loaded.rows, first, sort, loaded.totalCount);
  }

  private setOfficeStatus<S extends 'ACTIVE' | 'RETIRED'>(
    ctx: ServiceContext,
    input: unknown,
    status: S,
  ): Promise<{ id: string; status: S }> {
    ctx.authz.require('admin.civic:retire');
    const id = parseId(input);
    return this.repo.transaction(async (store, tx) => {
      const office = await store.findAdminOffice(id);
      if (!office) throw new NotFoundError();
      await store.setOfficeStatus(id, status);
      await this.record(tx, ctx, 'OFFICE', id, status === 'RETIRED' ? 'RETIRE' : 'RESTORE', { status: office.status }, { status });
      return { id, status };
    }, 'ReadCommitted');
  }

  private setServiceStatus<S extends 'ACTIVE' | 'RETIRED'>(
    ctx: ServiceContext,
    input: unknown,
    status: S,
  ): Promise<{ id: string; status: S }> {
    ctx.authz.require('admin.civic:retire');
    const id = parseId(input);
    return this.repo.transaction(async (store, tx) => {
      const service = await store.findAdminService(id);
      if (!service) throw new NotFoundError();
      await store.setServiceStatus(id, status);
      await this.record(
        tx,
        ctx,
        'SERVICE',
        id,
        status === 'RETIRED' ? 'RETIRE' : 'RESTORE',
        { status: service.status },
        { status },
      );
      return { id, status };
    }, 'ReadCommitted');
  }

  private async assertParent(
    store: CivicStore,
    id: string | undefined,
    parentId: string | null,
    type: JurisdictionType,
  ): Promise<void> {
    if (type !== 'NATION' && !parentId) {
      throw new ValidationError('A parent jurisdiction is required.', [
        { path: 'input.parentId', code: 'custom', message: 'A parent jurisdiction is required.' },
      ]);
    }
    if (!parentId) return;
    if (id && parentId === id) throw new JurisdictionCycleError();
    const seen = new Set<string>();
    let cursor: string | null = parentId;
    while (cursor) {
      if (seen.has(cursor) || (id !== undefined && cursor === id)) throw new JurisdictionCycleError();
      seen.add(cursor);
      const parent = await store.findJurisdiction(cursor);
      if (!parent) throw new NotFoundError();
      cursor = parent.parentId;
    }
  }

  private async allocateSlug(
    store: CivicStore,
    kind: 'office' | 'official',
    base: string,
    excludeId?: string,
  ): Promise<string> {
    const root = slugify(base);
    const taken = (slug: string) =>
      excludeId === undefined ? store.slugTaken(kind, slug) : store.slugTaken(kind, slug, excludeId);
    if (!(await taken(root))) return root;
    for (let n = 2; n < 10_000; n += 1) {
      const candidate = slugify(`${root}-${n}`);
      if (!(await taken(candidate))) return candidate;
    }
    return slugify(`${root}-${this.clock.now().getTime()}`);
  }

  private utcDay(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  private async notify(payload: Record<string, unknown>): Promise<void> {
    if (!this.enqueue) return;
    await this.enqueue('notify.fanout', payload);
  }

  private async record(
    tx: unknown,
    ctx: ServiceContext,
    entityType: string,
    entityId: string,
    action: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
  ): Promise<void> {
    let previous = before;
    let next = after;
    if (before && after) {
      const diff = changedFields(before, after);
      if (!diff) return;
      previous = diff.before;
      next = diff.after;
    }
    const actor = actorOf(ctx);
    await this.auditLog.record(tx, {
      actorType: actor.actorType,
      actorId: actor.actorId,
      entityType,
      entityId,
      action,
      before: previous,
      after: next,
      requestId: ctx.requestId,
    });
  }
}

function actorOf(ctx: ServiceContext): { actorType: AuditEntry['actorType']; actorId: string | null } {
  switch (ctx.principal.kind) {
    case 'admin':
      return { actorType: 'ADMIN', actorId: ctx.principal.adminId };
    case 'resident':
      return { actorType: 'RESIDENT', actorId: ctx.principal.userId };
    case 'system':
      return { actorType: 'SYSTEM', actorId: null };
    default:
      return { actorType: 'SYSTEM', actorId: null };
  }
}

function snapshot(value: object): Record<string, unknown> {
  const parsed: unknown = JSON.parse(JSON.stringify(value));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(parsed)) record[key] = entry;
  return record;
}

function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const previous: Record<string, unknown> = {};
  const next: Record<string, unknown> = {};
  let any = false;
  for (const key of keys) {
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    any = true;
    if (Object.prototype.hasOwnProperty.call(before, key)) previous[key] = before[key];
    if (Object.prototype.hasOwnProperty.call(after, key)) next[key] = after[key];
  }
  return any ? { before: previous, after: next } : null;
}

function contactChanged(before: AdminOfficeRecord | null, after: AdminOfficeRecord): boolean {
  if (!before) return true;
  return (
    before.phone !== after.phone ||
    before.email !== after.email ||
    before.website !== after.website ||
    before.contactUrl !== after.contactUrl ||
    before.holderUnknown !== after.holderUnknown ||
    before.name !== after.name ||
    JSON.stringify(before.addresses) !== JSON.stringify(after.addresses)
  );
}

function officialChanged(before: AdminOfficialRecord | null, after: AdminOfficialRecord): boolean {
  if (!before) return true;
  return (
    before.fullName !== after.fullName ||
    before.displayName !== after.displayName ||
    before.party !== after.party ||
    before.photoUrl !== after.photoUrl ||
    before.website !== after.website
  );
}

function adminSortName(row: { name?: string; fullName?: string; title?: string }): string {
  if (typeof row.fullName === 'string') return row.fullName;
  if (typeof row.title === 'string' && typeof row.name !== 'string') return row.title;
  return row.name ?? '';
}

function decodeAdminCursor(cursor: string, sort: AdminSort): AdminCursor | undefined {
  if (sort === 'NAME') {
    if (!cursor.startsWith('name:')) return undefined;
    try {
      const raw = Buffer.from(cursor.slice('name:'.length), 'base64url').toString('utf8');
      const sep = raw.indexOf('|');
      if (sep <= 0) return undefined;
      const name = raw.slice(0, sep);
      const id = raw.slice(sep + 1);
      if (id.length === 0) return undefined;
      return { kind: 'name', name, id };
    } catch {
      return undefined;
    }
  }
  const decoded = decodeCursor(cursor);
  if (!decoded) return undefined;
  return { kind: 'newest', createdAt: decoded.createdAt, id: decoded.id };
}

function adminConnection<T extends { createdAt: Date; id: string; name?: string; fullName?: string; title?: string }>(
  rows: T[],
  first: number,
  sort: AdminSort,
  totalCount: number,
): Connection<T> {
  const hasNextPage = rows.length > first;
  const page = hasNextPage ? rows.slice(0, first) : rows;
  const encode = (row: T): string =>
    sort === 'NAME'
      ? `name:${Buffer.from(`${adminSortName(row)}|${row.id}`, 'utf8').toString('base64url')}`
      : encodeCursor(row.createdAt, row.id);
  const last = page[page.length - 1];
  return {
    edges: page.map((node) => ({ cursor: encode(node), node })),
    pageInfo: { hasNextPage, endCursor: last ? encode(last) : null },
    totalCount,
  };
}
