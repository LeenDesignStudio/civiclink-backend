import { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { dbCall, prisma, withTx, type Db } from '../../db/prisma.js';
import { NotFoundError } from '../../lib/errors.js';
import type {
  AdminJurisdictionNode,
  AdminOfficeRecord,
  AdminOfficialRecord,
  OfficeTermRecord,
  AdminOfficialTerm,
  AdminServiceLink,
  AdminServiceRecord,
  JurisdictionBrief,
  JurisdictionRecord,
  OfficeAddressDto,
  OfficeRecord,
  OfficialRecord,
  PlanDto,
  LegalVersionDto,
  RecordStatus,
  ServiceCategoryRecord,
  ServiceRecord,
  TermStatus,
} from './civic.dto.js';
import type {
  OfficeAddressInput,
  UpsertJurisdictionInput,
  UpsertOfficeInput,
  UpsertOfficialInput,
  UpsertServiceCategoryInput,
  UpsertServiceInput,
} from './civic.inputs.js';

export type AdminSort = 'NEWEST' | 'NAME';

export type AdminCursor =
  | { kind: 'newest'; createdAt: Date; id: string }
  | { kind: 'name'; name: string; id: string };

export interface AdminPageQuery {
  first: number;
  sort: AdminSort;
  after?: AdminCursor;
  q?: string;
  status?: RecordStatus;
}

export interface JurisdictionAdminQuery extends AdminPageQuery {
  level?: JurisdictionRecord['level'];
  type?: JurisdictionRecord['type'];
  state?: string;
  freshness?: 'CURRENT' | 'MAY_BE_OUTDATED';
  freshnessCutoff: Date;
}

export interface OfficeAdminQuery extends AdminPageQuery {
  level?: JurisdictionRecord['level'];
  jurisdictionId?: string;
  vacantOnly?: boolean;
  staleOnly?: boolean;
  freshnessCutoff: Date;
}

export interface OfficialAdminQuery extends AdminPageQuery {
  officeId?: string;
}

export interface ServiceAdminQuery extends AdminPageQuery {
  categoryId?: string;
  linkBroken?: boolean;
}

export interface ListServicesArgs {
  jurisdictionIds: string[];
  officeIds: string[];
  categoryId?: string;
  first: number;
  after?: { createdAt: Date; id: string };
  /** When false, return at most `first` rows. Otherwise return `first + 1` for pagination. */
  paginate?: boolean;
}

export interface CreateTermInput {
  officeId: string;
  officialId: string;
  status: TermStatus;
  termStart: Date | null;
  termEnd: Date | null;
  isCurrent: boolean;
}

export interface CivicStore {
  transaction<T>(
    fn: (store: CivicStore, tx: unknown) => Promise<T>,
    isolation: 'Serializable' | 'ReadCommitted',
  ): Promise<T>;
  findOfficeBySlug(slug: string): Promise<OfficeRecord | null>;
  findOfficialBySlug(slug: string): Promise<OfficialRecord | null>;
  listServices(args: ListServicesArgs): Promise<ServiceRecord[]>;
  listActiveCategories(): Promise<ServiceCategoryRecord[]>;
  listActivePlans(): Promise<PlanDto[]>;
  listCurrentLegal(): Promise<LegalVersionDto[]>;
  jurisdictionBriefs(ids: string[]): Promise<JurisdictionBrief[]>;
  officesForJurisdictions(ids: string[]): Promise<OfficeRecord[]>;
  servicesForLinks(jurisdictionIds: string[], officeIds: string[], limit: number): Promise<ServiceRecord[]>;
  findJurisdiction(id: string): Promise<JurisdictionRecord | null>;
  listAdminJurisdictions(query: JurisdictionAdminQuery): Promise<{ rows: AdminJurisdictionNode[]; totalCount: number }>;
  listAdminOffices(query: OfficeAdminQuery): Promise<{ rows: Array<AdminOfficeRecord & { createdAt: Date }>; totalCount: number }>;
  listAdminOfficials(query: OfficialAdminQuery): Promise<{ rows: Array<AdminOfficialRecord & { createdAt: Date }>; totalCount: number }>;
  listAdminServices(query: ServiceAdminQuery): Promise<{ rows: Array<AdminServiceRecord & { createdAt: Date }>; totalCount: number }>;
  findAdminOffice(id: string): Promise<AdminOfficeRecord | null>;
  findAdminOfficial(id: string): Promise<AdminOfficialRecord | null>;
  findAdminService(id: string): Promise<AdminServiceRecord | null>;
  findCategoryById(id: string): Promise<ServiceCategoryRecord | null>;
  findCategoryByName(name: string): Promise<ServiceCategoryRecord | null>;
  sourceExists(id: string): Promise<boolean>;
  countActiveOffices(jurisdictionId: string): Promise<number>;
  retireActiveOffices(jurisdictionId: string): Promise<string[]>;
  slugTaken(kind: 'office' | 'official', slug: string, excludeId?: string): Promise<boolean>;
  createJurisdiction(input: UpsertJurisdictionInput): Promise<JurisdictionRecord>;
  updateJurisdiction(id: string, input: UpsertJurisdictionInput): Promise<JurisdictionRecord>;
  setJurisdictionStatus(id: string, status: RecordStatus): Promise<void>;
  createOffice(input: UpsertOfficeInput & { slug: string }): Promise<AdminOfficeRecord>;
  updateOffice(id: string, input: UpsertOfficeInput & { slug: string }): Promise<AdminOfficeRecord>;
  setOfficeStatus(id: string, status: RecordStatus): Promise<void>;
  createOfficial(input: UpsertOfficialInput & { slug: string }): Promise<AdminOfficialRecord>;
  updateOfficial(id: string, input: UpsertOfficialInput & { slug: string }): Promise<AdminOfficialRecord>;
  setOfficialStatus(id: string, status: RecordStatus): Promise<void>;
  endCurrentTerm(officeId: string, termEnd: Date): Promise<{ id: string } | null>;
  setHolderUnknown(officeId: string, holderUnknown: boolean): Promise<void>;
  createTerm(input: CreateTermInput): Promise<OfficeTermRecord>;
  findTerm(id: string): Promise<OfficeTermRecord | null>;
  endTerm(id: string, termEnd: Date): Promise<void>;
  officialHasCurrentTerm(officialId: string): Promise<boolean>;
  createService(input: UpsertServiceInput): Promise<AdminServiceRecord>;
  updateService(id: string, input: UpsertServiceInput): Promise<AdminServiceRecord>;
  setServiceStatus(id: string, status: RecordStatus): Promise<void>;
  createCategory(input: UpsertServiceCategoryInput): Promise<ServiceCategoryRecord>;
  updateCategory(id: string, input: UpsertServiceCategoryInput): Promise<ServiceCategoryRecord>;
}

function createdBefore(after: { createdAt: Date; id: string } | undefined): { OR: [{ createdAt: { lt: Date } }, { createdAt: Date; id: { lt: string } }] } | undefined {
  if (!after) return undefined;
  return {
    OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }],
  };
}

function newestClause(query: { sort: AdminSort; after?: AdminCursor }): ReturnType<typeof createdBefore> {
  if (query.sort !== 'NEWEST' || query.after?.kind !== 'newest') return undefined;
  return createdBefore(query.after);
}

function nameClause(field: 'name' | 'fullName' | 'title', query: { sort: AdminSort; after?: AdminCursor }): { OR: object[] } | undefined {
  if (query.sort !== 'NAME' || query.after?.kind !== 'name') return undefined;
  const name = query.after.name;
  const id = query.after.id;
  if (field === 'fullName') return { OR: [{ fullName: { gt: name } }, { fullName: name, id: { gt: id } }] };
  if (field === 'title') return { OR: [{ title: { gt: name } }, { title: name, id: { gt: id } }] };
  return { OR: [{ name: { gt: name } }, { name, id: { gt: id } }] };
}

function stringList(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function legalKind(kind: string): 'TERMS' | 'PRIVACY' | null {
  if (kind === 'TERMS' || kind === 'PRIVACY') return kind;
  return null;
}

const officeSelect = {
  id: true,
  slug: true,
  name: true,
  seatLabel: true,
  selectionMethod: true,
  displayOrder: true,
  whyTemplate: true,
  phone: true,
  email: true,
  website: true,
  contactUrl: true,
  holderUnknown: true,
  status: true,
  lastUpdatedAt: true,
  freshnessOverride: true,
  source: { select: { name: true, url: true, freshnessDays: true } },
  jurisdiction: {
    select: { id: true, name: true, level: true, type: true, districtCode: true, state: true },
  },
  addresses: {
    orderBy: { sortOrder: 'asc' as const },
    select: {
      id: true,
      label: true,
      street: true,
      city: true,
      state: true,
      zip: true,
      phone: true,
      hours: true,
    },
  },
  terms: {
    where: { isCurrent: true },
    take: 1,
    select: {
      status: true,
      official: {
        select: {
          id: true,
          slug: true,
          fullName: true,
          displayName: true,
          party: true,
          photoUrl: true,
          status: true,
        },
      },
    },
  },
};

function mapAddress(row: {
  id: string;
  label: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  phone: string | null;
  hours: string | null;
}): OfficeAddressDto {
  return {
    id: row.id,
    label: row.label,
    street: row.street,
    city: row.city,
    state: row.state,
    zip: row.zip,
    phone: row.phone,
    hours: row.hours,
  };
}

function mapOffice(row: {
  id: string;
  slug: string;
  name: string;
  seatLabel: string | null;
  selectionMethod: 'ELECTED' | 'APPOINTED';
  displayOrder: number;
  whyTemplate: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  contactUrl: string | null;
  holderUnknown: boolean;
  status: 'ACTIVE' | 'RETIRED';
  lastUpdatedAt: Date;
  freshnessOverride: 'NONE' | 'FORCE_CURRENT' | 'FORCE_OUTDATED';
  source: { name: string; url: string; freshnessDays: number };
  jurisdiction: OfficeRecord['jurisdiction'];
  addresses: OfficeAddressDto[];
  terms: Array<{
    status: TermStatus;
    official: {
      id: string;
      slug: string;
      fullName: string;
      displayName: string | null;
      party: string | null;
      photoUrl: string | null;
      status: 'ACTIVE' | 'RETIRED';
    };
  }>;
}): OfficeRecord {
  const term = row.terms[0];
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    seatLabel: row.seatLabel,
    selectionMethod: row.selectionMethod,
    displayOrder: row.displayOrder,
    whyTemplate: row.whyTemplate,
    phone: row.phone,
    email: row.email,
    website: row.website,
    contactUrl: row.contactUrl,
    holderUnknown: row.holderUnknown,
    status: row.status,
    lastUpdatedAt: row.lastUpdatedAt,
    freshnessOverride: row.freshnessOverride,
    source: {
      name: row.source.name,
      url: row.source.url,
      freshnessDays: row.source.freshnessDays,
    },
    jurisdiction: {
      id: row.jurisdiction.id,
      name: row.jurisdiction.name,
      level: row.jurisdiction.level,
      type: row.jurisdiction.type,
      districtCode: row.jurisdiction.districtCode,
      state: row.jurisdiction.state,
    },
    addresses: row.addresses.map(mapAddress),
    currentTerm: term
      ? {
          status: term.status,
          official: {
            id: term.official.id,
            slug: term.official.slug,
            fullName: term.official.fullName,
            displayName: term.official.displayName,
            party: term.official.party,
            photoUrl: term.official.photoUrl,
            status: term.official.status,
          },
        }
      : null,
  };
}

export class CivicRepo implements CivicStore {
  constructor(
    private readonly db: Db,
    private readonly client: PrismaClient = prisma,
    private readonly mapErrors = true,
  ) {}

  transaction<T>(
    fn: (store: CivicStore, tx: unknown) => Promise<T>,
    isolation: 'Serializable' | 'ReadCommitted',
  ): Promise<T> {
    return withTx((tx) => fn(new CivicRepo(tx, this.client, false), tx), {
      isolation:
        isolation === 'Serializable'
          ? Prisma.TransactionIsolationLevel.Serializable
          : Prisma.TransactionIsolationLevel.ReadCommitted,
      client: this.client,
    });
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.mapErrors) return fn();
    return dbCall(fn);
  }

  findOfficeBySlug(slug: string): Promise<OfficeRecord | null> {
    return this.run(async () => {
      const row = await this.db.office.findFirst({ where: { slug }, select: officeSelect });
      return row ? mapOffice(row) : null;
    });
  }

  officesForJurisdictions(ids: string[]): Promise<OfficeRecord[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.run(async () => {
      const rows = await this.db.office.findMany({
        where: { status: 'ACTIVE', jurisdictionId: { in: ids } },
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        select: officeSelect,
      });
      return rows.map(mapOffice);
    });
  }

  findOfficialBySlug(slug: string): Promise<OfficialRecord | null> {
    return this.run(() => this.loadOfficial(slug));
  }

  private async loadOfficial(slug: string): Promise<OfficialRecord | null> {
    const row = await this.db.official.findFirst({
      where: { slug },
      select: {
        id: true,
        slug: true,
        fullName: true,
        displayName: true,
        party: true,
        photoUrl: true,
        website: true,
        status: true,
        lastUpdatedAt: true,
        freshnessOverride: true,
        source: { select: { name: true, url: true, freshnessDays: true } },
        terms: {
          orderBy: [{ isCurrent: 'desc' }, { termEnd: 'desc' }],
          select: {
            isCurrent: true,
            termEnd: true,
            office: {
              select: {
                id: true,
                slug: true,
                name: true,
                status: true,
                whyTemplate: true,
                jurisdiction: {
                  select: { id: true, name: true, level: true, type: true, districtCode: true, state: true },
                },
              },
            },
          },
        },
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      slug: row.slug,
      fullName: row.fullName,
      displayName: row.displayName,
      party: row.party,
      photoUrl: row.photoUrl,
      website: row.website,
      status: row.status,
      lastUpdatedAt: row.lastUpdatedAt,
      freshnessOverride: row.freshnessOverride,
      source: {
        name: row.source.name,
        url: row.source.url,
        freshnessDays: row.source.freshnessDays,
      },
      terms: row.terms.map((term) => ({
        isCurrent: term.isCurrent,
        termEnd: term.termEnd,
        office: {
          id: term.office.id,
          slug: term.office.slug,
          name: term.office.name,
          status: term.office.status,
          whyTemplate: term.office.whyTemplate,
          jurisdiction: term.office.jurisdiction,
        },
      })),
    };
  }

  listServices(args: ListServicesArgs): Promise<ServiceRecord[]> {
    return this.run(() => this.queryServices(args));
  }

  servicesForLinks(jurisdictionIds: string[], officeIds: string[], limit: number): Promise<ServiceRecord[]> {
    return this.run(() =>
      this.queryServices({
        jurisdictionIds,
        officeIds,
        first: limit,
        paginate: false,
      }),
    );
  }

  private async queryServices(args: ListServicesArgs): Promise<ServiceRecord[]> {
    const linkOr: Array<{ jurisdictionId: { in: string[] } } | { officeId: { in: string[] } }> = [];
    if (args.jurisdictionIds.length > 0) linkOr.push({ jurisdictionId: { in: args.jurisdictionIds } });
    if (args.officeIds.length > 0) linkOr.push({ officeId: { in: args.officeIds } });
    if (linkOr.length === 0) return [];
    const rows = await this.db.service.findMany({
      where: {
        status: 'ACTIVE',
        ...(args.categoryId ? { categoryId: args.categoryId } : {}),
        links: { some: { OR: linkOr } },
        ...(args.after
          ? {
              OR: [
                { createdAt: { lt: args.after.createdAt } },
                { createdAt: args.after.createdAt, id: { lt: args.after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: args.paginate === false ? args.first : args.first + 1,
      select: {
        id: true,
        title: true,
        description: true,
        url: true,
        phoneContact: true,
        createdAt: true,
        status: true,
        category: { select: { id: true, name: true, sortOrder: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      url: row.url,
      phoneContact: row.phoneContact,
      createdAt: row.createdAt,
      status: row.status,
      category: row.category,
    }));
  }

  listActiveCategories(): Promise<ServiceCategoryRecord[]> {
    return this.run(async () => {
      const rows = await this.db.serviceCategory.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, sortOrder: true, active: true },
      });
      return rows;
    });
  }

  listActivePlans(): Promise<PlanDto[]> {
    return this.run(async () => {
      const rows = await this.db.plan.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, amountCents: true, currency: true, interval: true, features: true },
      });
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        amountCents: row.amountCents,
        currency: row.currency,
        interval: row.interval,
        features: stringList(row.features),
      }));
    });
  }

  listCurrentLegal(): Promise<LegalVersionDto[]> {
    return this.run(async () => {
      const rows = await this.db.legalDocument.findMany({
        where: { current: true, kind: { in: ['TERMS', 'PRIVACY'] } },
        select: { kind: true, version: true, effectiveAt: true },
      });
      const versions: LegalVersionDto[] = [];
      for (const row of rows) {
        const kind = legalKind(row.kind);
        if (kind) versions.push({ kind, version: row.version, effectiveAt: row.effectiveAt });
      }
      return versions;
    });
  }

  jurisdictionBriefs(ids: string[]): Promise<JurisdictionBrief[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.run(async () =>
      this.db.jurisdiction.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, level: true, type: true },
      }),
    );
  }

  findJurisdiction(id: string): Promise<JurisdictionRecord | null> {
    return this.run(async () => {
      const row = await this.db.jurisdiction.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          level: true,
          type: true,
          subtype: true,
          parentId: true,
          districtCode: true,
          geoid: true,
          state: true,
          boundaryVintage: true,
          website: true,
          sourceId: true,
          sourceRecordUrl: true,
          lastUpdatedAt: true,
          freshnessOverride: true,
          freshnessNote: true,
          status: true,
        },
      });
      return row;
    });
  }

  listAdminJurisdictions(query: JurisdictionAdminQuery): Promise<{ rows: AdminJurisdictionNode[]; totalCount: number }> {
    return this.run(async () => {
      const where: Prisma.JurisdictionWhereInput = {};
      if (query.level) where.level = query.level;
      if (query.type) where.type = query.type;
      if (query.state) where.state = query.state;
      if (query.status) where.status = query.status;
      if (query.q) where.name = { contains: query.q, mode: 'insensitive' };
      const and: Prisma.JurisdictionWhereInput[] = [];
      if (query.freshness === 'CURRENT') {
        and.push({
          OR: [
            { freshnessOverride: 'FORCE_CURRENT' },
            { freshnessOverride: 'NONE', lastUpdatedAt: { gte: query.freshnessCutoff } },
          ],
        });
      } else if (query.freshness === 'MAY_BE_OUTDATED') {
        and.push({
          OR: [
            { freshnessOverride: 'FORCE_OUTDATED' },
            { freshnessOverride: 'NONE', lastUpdatedAt: { lt: query.freshnessCutoff } },
          ],
        });
      }
      if (and.length > 0) where.AND = and;
      const totalCount = await this.db.jurisdiction.count({ where });
      const cursor = newestClause(query) ?? nameClause('name', query);
      if (cursor) and.push(cursor);
      if (and.length > 0) where.AND = and;
      const rows = await this.db.jurisdiction.findMany({
        where,
        orderBy: query.sort === 'NAME' ? [{ name: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.first + 1,
        select: {
          id: true,
          name: true,
          level: true,
          type: true,
          subtype: true,
          parentId: true,
          districtCode: true,
          geoid: true,
          state: true,
          boundaryVintage: true,
          website: true,
          sourceId: true,
          sourceRecordUrl: true,
          lastUpdatedAt: true,
          freshnessOverride: true,
          freshnessNote: true,
          status: true,
          createdAt: true,
        },
      });
      const flags = await this.boundaryFlags(rows.map((row) => row.id));
      return { totalCount, rows: rows.map((row) => ({ ...row, hasBoundary: flags.get(row.id) ?? false })) };
    });
  }

  listAdminOffices(query: OfficeAdminQuery): Promise<{ rows: Array<AdminOfficeRecord & { createdAt: Date }>; totalCount: number }> {
    return this.run(async () => {
      const where: Prisma.OfficeWhereInput = {};
      if (query.jurisdictionId) where.jurisdictionId = query.jurisdictionId;
      if (query.status) where.status = query.status;
      if (query.level) where.jurisdiction = { level: query.level };
      if (query.q) where.name = { contains: query.q, mode: 'insensitive' };
      if (query.vacantOnly) where.terms = { none: { isCurrent: true } };
      const and: Prisma.OfficeWhereInput[] = [];
      if (query.staleOnly) {
        and.push({
          OR: [
            { freshnessOverride: 'FORCE_OUTDATED' },
            { freshnessOverride: 'NONE', lastUpdatedAt: { lt: query.freshnessCutoff } },
          ],
        });
      }
      if (and.length > 0) where.AND = and;
      const totalCount = await this.db.office.count({ where });
      const cursor = newestClause(query) ?? nameClause('name', query);
      if (cursor) and.push(cursor);
      if (and.length > 0) where.AND = and;
      const rows = await this.db.office.findMany({
        where,
        orderBy: query.sort === 'NAME' ? [{ name: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.first + 1,
        select: {
          id: true,
          slug: true,
          jurisdictionId: true,
          name: true,
          seatLabel: true,
          selectionMethod: true,
          displayOrder: true,
          whyTemplate: true,
          phone: true,
          email: true,
          website: true,
          contactUrl: true,
          holderUnknown: true,
          sourceId: true,
          sourceRecordUrl: true,
          lastUpdatedAt: true,
          freshnessOverride: true,
          freshnessNote: true,
          status: true,
          createdAt: true,
          addresses: {
            orderBy: { sortOrder: 'asc' },
            select: { id: true, label: true, street: true, city: true, state: true, zip: true, phone: true, hours: true },
          },
          _count: { select: { follows: true } },
        },
      });
      return {
        totalCount,
        rows: rows.map((row) => ({
          id: row.id,
          slug: row.slug,
          jurisdictionId: row.jurisdictionId,
          name: row.name,
          seatLabel: row.seatLabel,
          selectionMethod: row.selectionMethod,
          displayOrder: row.displayOrder,
          whyTemplate: row.whyTemplate,
          phone: row.phone,
          email: row.email,
          website: row.website,
          contactUrl: row.contactUrl,
          holderUnknown: row.holderUnknown,
          sourceId: row.sourceId,
          sourceRecordUrl: row.sourceRecordUrl,
          lastUpdatedAt: row.lastUpdatedAt,
          freshnessOverride: row.freshnessOverride,
          freshnessNote: row.freshnessNote,
          status: row.status,
          followerCount: row._count.follows,
          addresses: row.addresses.map(mapAddress),
          createdAt: row.createdAt,
        })),
      };
    });
  }

  listAdminOfficials(query: OfficialAdminQuery): Promise<{ rows: Array<AdminOfficialRecord & { createdAt: Date }>; totalCount: number }> {
    return this.run(async () => {
      const where: Prisma.OfficialWhereInput = {};
      if (query.status) where.status = query.status;
      if (query.officeId) where.terms = { some: { officeId: query.officeId } };
      if (query.q) {
        where.OR = [
          { fullName: { contains: query.q, mode: 'insensitive' } },
          { displayName: { contains: query.q, mode: 'insensitive' } },
        ];
      }
      const totalCount = await this.db.official.count({ where });
      const cursor = newestClause(query) ?? nameClause('fullName', query);
      if (cursor) where.AND = [cursor];
      const rows = await this.db.official.findMany({
        where,
        orderBy: query.sort === 'NAME' ? [{ fullName: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.first + 1,
        select: {
          id: true,
          slug: true,
          fullName: true,
          displayName: true,
          party: true,
          photoUrl: true,
          website: true,
          sourceId: true,
          sourceRecordUrl: true,
          lastUpdatedAt: true,
          freshnessOverride: true,
          freshnessNote: true,
          status: true,
          createdAt: true,
          terms: adminTermSelect,
        },
      });
      return { totalCount, rows: rows.map((row) => ({ ...mapAdminOfficial(row), createdAt: row.createdAt })) };
    });
  }

  listAdminServices(query: ServiceAdminQuery): Promise<{ rows: Array<AdminServiceRecord & { createdAt: Date }>; totalCount: number }> {
    return this.run(async () => {
      const where: Prisma.ServiceWhereInput = {};
      if (query.categoryId) where.categoryId = query.categoryId;
      if (query.status) where.status = query.status;
      if (query.linkBroken !== undefined) where.linkBroken = query.linkBroken;
      if (query.q) where.title = { contains: query.q, mode: 'insensitive' };
      const totalCount = await this.db.service.count({ where });
      const cursor = newestClause(query) ?? nameClause('title', query);
      if (cursor) where.AND = [cursor];
      const rows = await this.db.service.findMany({
        where,
        orderBy: query.sort === 'NAME' ? [{ title: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.first + 1,
        select: {
          id: true,
          title: true,
          categoryId: true,
          description: true,
          url: true,
          phoneContact: true,
          lastValidatedAt: true,
          sourceId: true,
          status: true,
          createdAt: true,
          links: { select: { id: true, jurisdictionId: true, officeId: true } },
        },
      });
      return { totalCount, rows: rows.map((row) => ({ ...mapAdminService(row), createdAt: row.createdAt })) };
    });
  }

  findAdminOffice(id: string): Promise<AdminOfficeRecord | null> {
    return this.run(() => this.loadAdminOffice(id));
  }

  private async loadAdminOffice(id: string): Promise<AdminOfficeRecord | null> {
    const row = await this.db.office.findUnique({
      where: { id },
      select: {
        id: true,
        slug: true,
        jurisdictionId: true,
        name: true,
        seatLabel: true,
        selectionMethod: true,
        displayOrder: true,
        whyTemplate: true,
        phone: true,
        email: true,
        website: true,
        contactUrl: true,
        holderUnknown: true,
        sourceId: true,
        sourceRecordUrl: true,
        lastUpdatedAt: true,
        freshnessOverride: true,
        freshnessNote: true,
        status: true,
        addresses: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            label: true,
            street: true,
            city: true,
            state: true,
            zip: true,
            phone: true,
            hours: true,
          },
        },
        _count: { select: { follows: true } },
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      slug: row.slug,
      jurisdictionId: row.jurisdictionId,
      name: row.name,
      seatLabel: row.seatLabel,
      selectionMethod: row.selectionMethod,
      displayOrder: row.displayOrder,
      whyTemplate: row.whyTemplate,
      phone: row.phone,
      email: row.email,
      website: row.website,
      contactUrl: row.contactUrl,
      holderUnknown: row.holderUnknown,
      sourceId: row.sourceId,
      sourceRecordUrl: row.sourceRecordUrl,
      lastUpdatedAt: row.lastUpdatedAt,
      freshnessOverride: row.freshnessOverride,
      freshnessNote: row.freshnessNote,
      status: row.status,
      followerCount: row._count.follows,
      addresses: row.addresses.map(mapAddress),
    };
  }

  findAdminOfficial(id: string): Promise<AdminOfficialRecord | null> {
    return this.run(() => this.loadAdminOfficial(id));
  }

  findAdminService(id: string): Promise<AdminServiceRecord | null> {
    return this.run(() => this.loadAdminService(id));
  }

  findCategoryById(id: string): Promise<ServiceCategoryRecord | null> {
    return this.run(() =>
      this.db.serviceCategory.findUnique({
        where: { id },
        select: { id: true, name: true, sortOrder: true, active: true },
      }),
    );
  }

  findCategoryByName(name: string): Promise<ServiceCategoryRecord | null> {
    return this.run(() =>
      this.db.serviceCategory.findUnique({
        where: { name },
        select: { id: true, name: true, sortOrder: true, active: true },
      }),
    );
  }

  sourceExists(id: string): Promise<boolean> {
    return this.run(async () => (await this.db.source.findUnique({ where: { id }, select: { id: true } })) !== null);
  }

  countActiveOffices(jurisdictionId: string): Promise<number> {
    return this.run(() => this.db.office.count({ where: { jurisdictionId, status: 'ACTIVE' } }));
  }

  retireActiveOffices(jurisdictionId: string): Promise<string[]> {
    return this.run(async () => {
      const rows = await this.db.office.findMany({
        where: { jurisdictionId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (rows.length === 0) return [];
      await this.db.office.updateMany({
        where: { id: { in: rows.map((row) => row.id) } },
        data: { status: 'RETIRED' },
      });
      return rows.map((row) => row.id);
    });
  }

  slugTaken(kind: 'office' | 'official', slug: string, excludeId?: string): Promise<boolean> {
    return this.run(async () => {
      const row =
        kind === 'office'
          ? await this.db.office.findUnique({ where: { slug }, select: { id: true } })
          : await this.db.official.findUnique({ where: { slug }, select: { id: true } });
      return row !== null && row.id !== excludeId;
    });
  }

  createJurisdiction(input: UpsertJurisdictionInput): Promise<JurisdictionRecord> {
    return this.run(async () => {
      const row = await this.db.jurisdiction.create({
        data: jurisdictionData(input),
        select: { id: true },
      });
      const loaded = await this.loadJurisdiction(row.id);
      if (!loaded) throw new NotFoundError();
      return loaded;
    });
  }

  updateJurisdiction(id: string, input: UpsertJurisdictionInput): Promise<JurisdictionRecord> {
    return this.run(async () => {
      await this.db.jurisdiction.update({ where: { id }, data: jurisdictionData(input) });
      const loaded = await this.loadJurisdiction(id);
      if (!loaded) throw new NotFoundError();
      return loaded;
    });
  }

  setJurisdictionStatus(id: string, status: RecordStatus): Promise<void> {
    return this.run(async () => {
      await this.db.jurisdiction.update({ where: { id }, data: { status } });
    });
  }

  createOffice(input: UpsertOfficeInput & { slug: string }): Promise<AdminOfficeRecord> {
    return this.run(async () => {
      const row = await this.db.office.create({
        data: { ...officeData(input), slug: input.slug },
        select: { id: true },
      });
      await this.writeAddresses(row.id, input.addresses);
      const loaded = await this.loadAdminOffice(row.id);
      if (!loaded) throw new NotFoundError();
      return loaded;
    });
  }

  updateOffice(id: string, input: UpsertOfficeInput & { slug: string }): Promise<AdminOfficeRecord> {
    return this.run(async () => {
      await this.db.office.update({ where: { id }, data: { ...officeData(input), slug: input.slug } });
      await this.writeAddresses(id, input.addresses);
      const loaded = await this.loadAdminOffice(id);
      if (!loaded) throw new NotFoundError();
      return loaded;
    });
  }

  setOfficeStatus(id: string, status: RecordStatus): Promise<void> {
    return this.run(async () => {
      await this.db.office.update({ where: { id }, data: { status } });
    });
  }

  createOfficial(input: UpsertOfficialInput & { slug: string }): Promise<AdminOfficialRecord> {
    return this.run(async () => {
      const row = await this.db.official.create({
        data: { ...officialData(input), slug: input.slug },
        select: { id: true },
      });
      const loaded = await this.loadAdminOfficial(row.id);
      if (!loaded) throw new NotFoundError();
      return loaded;
    });
  }

  updateOfficial(id: string, input: UpsertOfficialInput & { slug: string }): Promise<AdminOfficialRecord> {
    return this.run(async () => {
      await this.db.official.update({ where: { id }, data: { ...officialData(input), slug: input.slug } });
      const loaded = await this.loadAdminOfficial(id);
      if (!loaded) throw new NotFoundError();
      return loaded;
    });
  }

  setOfficialStatus(id: string, status: RecordStatus): Promise<void> {
    return this.run(async () => {
      await this.db.official.update({ where: { id }, data: { status } });
    });
  }

  endCurrentTerm(officeId: string, termEnd: Date): Promise<{ id: string } | null> {
    return this.run(async () => {
      const current = await this.db.officeTerm.findFirst({
        where: { officeId, isCurrent: true },
        select: { id: true },
      });
      if (!current) return null;
      await this.db.officeTerm.update({
        where: { id: current.id },
        data: { isCurrent: false, termEnd },
      });
      return current;
    });
  }

  setHolderUnknown(officeId: string, holderUnknown: boolean): Promise<void> {
    return this.run(async () => {
      await this.db.office.update({ where: { id: officeId }, data: { holderUnknown } });
    });
  }

  createTerm(input: CreateTermInput): Promise<OfficeTermRecord> {
    return this.run(() =>
      this.db.officeTerm.create({
        data: {
          officeId: input.officeId,
          officialId: input.officialId,
          status: input.status,
          termStart: input.termStart,
          termEnd: input.termEnd,
          isCurrent: input.isCurrent,
        },
        select: termSelect,
      }),
    );
  }

  findTerm(id: string): Promise<OfficeTermRecord | null> {
    return this.run(() =>
      this.db.officeTerm.findUnique({
        where: { id },
        select: termSelect,
      }),
    );
  }

  endTerm(id: string, termEnd: Date): Promise<void> {
    return this.run(async () => {
      await this.db.officeTerm.update({
        where: { id },
        data: { isCurrent: false, termEnd },
      });
    });
  }

  officialHasCurrentTerm(officialId: string): Promise<boolean> {
    return this.run(async () => (await this.db.officeTerm.count({ where: { officialId, isCurrent: true } })) > 0);
  }

  createService(input: UpsertServiceInput): Promise<AdminServiceRecord> {
    return this.run(async () => {
      const row = await this.db.service.create({ data: serviceData(input), select: { id: true } });
      await this.writeLinks(row.id, input.jurisdictionIds, input.officeIds);
      const loaded = await this.loadAdminService(row.id);
      if (!loaded) throw new NotFoundError();
      return loaded;
    });
  }

  updateService(id: string, input: UpsertServiceInput): Promise<AdminServiceRecord> {
    return this.run(async () => {
      await this.db.service.update({ where: { id }, data: serviceData(input) });
      await this.writeLinks(id, input.jurisdictionIds, input.officeIds);
      const loaded = await this.loadAdminService(id);
      if (!loaded) throw new NotFoundError();
      return loaded;
    });
  }

  setServiceStatus(id: string, status: RecordStatus): Promise<void> {
    return this.run(async () => {
      await this.db.service.update({ where: { id }, data: { status } });
    });
  }

  createCategory(input: UpsertServiceCategoryInput): Promise<ServiceCategoryRecord> {
    return this.run(() =>
      this.db.serviceCategory.create({
        data: { name: input.name, sortOrder: input.sortOrder, active: input.active },
        select: { id: true, name: true, sortOrder: true, active: true },
      }),
    );
  }

  updateCategory(id: string, input: UpsertServiceCategoryInput): Promise<ServiceCategoryRecord> {
    return this.run(() =>
      this.db.serviceCategory.update({
        where: { id },
        data: { name: input.name, sortOrder: input.sortOrder, active: input.active },
        select: { id: true, name: true, sortOrder: true, active: true },
      }),
    );
  }

  private async boundaryFlags(ids: string[]): Promise<Map<string, boolean>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db.$queryRaw<Array<{ id: string; has_boundary: boolean }>>`
      SELECT id::text AS id, (boundary IS NOT NULL) AS has_boundary
      FROM jurisdictions
      WHERE id::text IN (${Prisma.join(ids)})
    `;
    return new Map(rows.map((row) => [row.id, row.has_boundary]));
  }

  private async loadJurisdiction(id: string): Promise<JurisdictionRecord | null> {
    return this.db.jurisdiction.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        level: true,
        type: true,
        subtype: true,
        parentId: true,
        districtCode: true,
        geoid: true,
        state: true,
        boundaryVintage: true,
        website: true,
        sourceId: true,
        sourceRecordUrl: true,
        lastUpdatedAt: true,
        freshnessOverride: true,
        freshnessNote: true,
        status: true,
      },
    });
  }

  private async loadAdminOfficial(id: string): Promise<AdminOfficialRecord | null> {
    const row = await this.db.official.findUnique({
      where: { id },
      select: {
        id: true,
        slug: true,
        fullName: true,
        displayName: true,
        party: true,
        photoUrl: true,
        website: true,
        sourceId: true,
        sourceRecordUrl: true,
        lastUpdatedAt: true,
        freshnessOverride: true,
        freshnessNote: true,
        status: true,
        terms: adminTermSelect,
      },
    });
    return row ? mapAdminOfficial(row) : null;
  }

  private async loadAdminService(id: string): Promise<AdminServiceRecord | null> {
    const row = await this.db.service.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        categoryId: true,
        description: true,
        url: true,
        phoneContact: true,
        lastValidatedAt: true,
        sourceId: true,
        status: true,
        links: { select: { id: true, jurisdictionId: true, officeId: true } },
      },
    });
    return row ? mapAdminService(row) : null;
  }

  private async writeAddresses(officeId: string, addresses: OfficeAddressInput[]): Promise<void> {
    await this.db.officeAddress.deleteMany({ where: { officeId } });
    if (addresses.length === 0) return;
    await this.db.officeAddress.createMany({
      data: addresses.map((address, index) => ({
        officeId,
        label: address.label,
        street: address.street,
        city: address.city,
        state: address.state,
        zip: address.zip,
        sortOrder: index,
        phone: address.phone,
        hours: address.hours,
      })),
    });
  }

  private async writeLinks(serviceId: string, jurisdictionIds: string[], officeIds: string[]): Promise<void> {
    await this.db.serviceLink.deleteMany({ where: { serviceId } });
    const data = [
      ...jurisdictionIds.map((jurisdictionId) => ({ serviceId, jurisdictionId })),
      ...officeIds.map((officeId) => ({ serviceId, officeId })),
    ];
    if (data.length === 0) return;
    await this.db.serviceLink.createMany({ data });
  }
}

const termSelect = {
  id: true,
  officeId: true,
  officialId: true,
  status: true,
  termStart: true,
  termEnd: true,
  isCurrent: true,
} as const;

const adminTermSelect = {
  orderBy: [{ isCurrent: 'desc' as const }, { createdAt: 'desc' as const }],
  select: {
    id: true,
    officeId: true,
    status: true,
    termStart: true,
    termEnd: true,
    isCurrent: true,
    office: { select: { id: true, slug: true, name: true, status: true } },
  },
};

function mapAdminOfficial(row: {
  id: string;
  slug: string;
  fullName: string;
  displayName: string | null;
  party: string | null;
  photoUrl: string | null;
  website: string | null;
  sourceId: string;
  sourceRecordUrl: string | null;
  lastUpdatedAt: Date;
  freshnessOverride: AdminOfficialRecord['freshnessOverride'];
  freshnessNote: string | null;
  status: RecordStatus;
  terms: AdminOfficialTerm[];
}): AdminOfficialRecord {
  return {
    id: row.id,
    slug: row.slug,
    fullName: row.fullName,
    displayName: row.displayName,
    party: row.party,
    photoUrl: row.photoUrl,
    website: row.website,
    sourceId: row.sourceId,
    sourceRecordUrl: row.sourceRecordUrl,
    lastUpdatedAt: row.lastUpdatedAt,
    freshnessOverride: row.freshnessOverride,
    freshnessNote: row.freshnessNote,
    status: row.status,
    terms: row.terms,
  };
}

function mapAdminService(row: {
  id: string;
  title: string;
  categoryId: string;
  description: string;
  url: string | null;
  phoneContact: string | null;
  lastValidatedAt: Date;
  sourceId: string;
  status: RecordStatus;
  links: AdminServiceLink[];
}): AdminServiceRecord {
  return {
    id: row.id,
    title: row.title,
    categoryId: row.categoryId,
    description: row.description,
    url: row.url,
    phoneContact: row.phoneContact,
    lastValidatedAt: row.lastValidatedAt,
    sourceId: row.sourceId,
    status: row.status,
    links: row.links,
    jurisdictionIds: row.links.flatMap((link) => (link.jurisdictionId ? [link.jurisdictionId] : [])),
    officeIds: row.links.flatMap((link) => (link.officeId ? [link.officeId] : [])),
  };
}

function jurisdictionData(input: UpsertJurisdictionInput) {
  return {
    name: input.name,
    level: input.level,
    type: input.type,
    subtype: input.subtype,
    parentId: input.parentId,
    districtCode: input.districtCode,
    geoid: input.geoid,
    state: input.state,
    website: input.website,
    sourceId: input.sourceId,
    sourceRecordUrl: input.sourceRecordUrl,
    lastUpdatedAt: input.lastUpdatedAt,
    freshnessOverride: input.freshnessOverride,
    freshnessNote: input.freshnessNote,
  };
}

function officeData(input: UpsertOfficeInput) {
  return {
    jurisdictionId: input.jurisdictionId,
    name: input.name,
    seatLabel: input.seatLabel,
    selectionMethod: input.selectionMethod,
    displayOrder: input.displayOrder,
    whyTemplate: input.whyTemplate,
    phone: input.phone,
    email: input.email,
    website: input.website,
    contactUrl: input.contactUrl,
    holderUnknown: input.holderUnknown,
    sourceId: input.sourceId,
    sourceRecordUrl: input.sourceRecordUrl,
    lastUpdatedAt: input.lastUpdatedAt,
    freshnessOverride: input.freshnessOverride,
    freshnessNote: input.freshnessNote,
  };
}

function officialData(input: UpsertOfficialInput) {
  return {
    fullName: input.fullName,
    displayName: input.displayName,
    party: input.party,
    photoUrl: input.photoUrl,
    website: input.website,
    sourceId: input.sourceId,
    sourceRecordUrl: input.sourceRecordUrl,
    lastUpdatedAt: input.lastUpdatedAt,
    freshnessOverride: input.freshnessOverride,
    freshnessNote: input.freshnessNote,
  };
}

function serviceData(input: UpsertServiceInput) {
  return {
    title: input.title,
    categoryId: input.categoryId,
    description: input.description,
    url: input.url,
    phoneContact: input.phoneContact,
    lastValidatedAt: input.lastValidatedAt,
    sourceId: input.sourceId,
  };
}
