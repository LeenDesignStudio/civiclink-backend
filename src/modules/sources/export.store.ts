import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { ExportList, ExportReader, ObjectStore } from './export.js';

const TEN_MINUTES_MS = 600_000;

export function exportCell(value: string | number | boolean | Date | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export class MemoryExportStore implements ObjectStore {
  private readonly files = new Map<string, { body: Uint8Array; contentType: string; expiresAt: number }>();

  async put(input: { key: string; body: Uint8Array; contentType: string }): Promise<void> {
    this.files.set(input.key, {
      body: input.body,
      contentType: input.contentType,
      expiresAt: Date.now() + TEN_MINUTES_MS,
    });
  }

  async presign(key: string, expiresSeconds: number, baseUrl?: string): Promise<string> {
    const file = this.files.get(key);
    if (file) file.expiresAt = Date.now() + expiresSeconds * 1000;
    const base = (baseUrl ?? 'http://127.0.0.1:4000').replace(/\/$/, '');
    return `${base}/dev/exports/${encodeURIComponent(key)}`;
  }

  read(token: string): { body: Uint8Array; contentType: string } | undefined {
    const file = this.files.get(decodeURIComponent(token));
    if (!file || file.expiresAt <= Date.now()) {
      if (file) this.files.delete(decodeURIComponent(token));
      return undefined;
    }
    return { body: file.body, contentType: file.contentType };
  }
}

export class S3ExportStore implements ObjectStore {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    region: string,
  ) {
    this.client = new S3Client({ region });
  }

  async put(input: { key: string; body: Uint8Array; contentType: string }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: `exports/${input.key}`,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );
  }

  presign(key: string, expiresSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: `exports/${key}` }),
      { expiresIn: expiresSeconds },
    );
  }
}

export class PrismaExportReader implements ExportReader {
  constructor(private readonly db: PrismaClient) {}

  async count(list: ExportList, filter: Record<string, string>): Promise<number> {
    switch (list) {
      case 'JURISDICTIONS':
        return this.db.jurisdiction.count({ where: this.jurisdictionWhere(filter) });
      case 'OFFICES':
        return this.db.office.count({ where: this.officeWhere(filter) });
      case 'OFFICIALS':
        return this.db.official.count({ where: this.officialWhere(filter) });
      case 'SERVICES':
        return this.db.service.count({ where: this.serviceWhere(filter) });
      case 'SOURCES':
        return this.db.source.count({ where: this.sourceWhere(filter) });
      case 'CORRECTIONS':
        return this.db.correction.count({ where: this.correctionWhere(filter) });
      case 'ALERTS':
        return this.db.alert.count({ where: this.alertWhere(filter) });
      default:
        return 0;
    }
  }

  async rows(
    list: ExportList,
    filter: Record<string, string>,
    limit: number,
  ): Promise<{ headers: string[]; rows: string[][] }> {
    switch (list) {
      case 'JURISDICTIONS': {
        const found = await this.db.jurisdiction.findMany({
          where: this.jurisdictionWhere(filter),
          take: limit,
          orderBy: { name: 'asc' },
          select: { id: true, name: true, level: true, type: true, state: true, status: true, geoid: true },
        });
        return table(
          ['id', 'name', 'level', 'type', 'state', 'status', 'geoid'],
          found.map((row) => [row.id, row.name, row.level, row.type, row.state, row.status, row.geoid]),
        );
      }
      case 'OFFICES': {
        const found = await this.db.office.findMany({
          where: this.officeWhere(filter),
          take: limit,
          orderBy: { name: 'asc' },
          select: { id: true, slug: true, name: true, jurisdictionId: true, status: true, selectionMethod: true },
        });
        return table(
          ['id', 'slug', 'name', 'jurisdictionId', 'status', 'selectionMethod'],
          found.map((row) => [row.id, row.slug, row.name, row.jurisdictionId, row.status, row.selectionMethod]),
        );
      }
      case 'OFFICIALS': {
        const found = await this.db.official.findMany({
          where: this.officialWhere(filter),
          take: limit,
          orderBy: { fullName: 'asc' },
          select: { id: true, slug: true, fullName: true, party: true, status: true },
        });
        return table(
          ['id', 'slug', 'fullName', 'party', 'status'],
          found.map((row) => [row.id, row.slug, row.fullName, row.party, row.status]),
        );
      }
      case 'SERVICES': {
        const found = await this.db.service.findMany({
          where: this.serviceWhere(filter),
          take: limit,
          orderBy: { title: 'asc' },
          select: { id: true, title: true, categoryId: true, status: true, linkBroken: true },
        });
        return table(
          ['id', 'title', 'categoryId', 'status', 'linkBroken'],
          found.map((row) => [row.id, row.title, row.categoryId, row.status, row.linkBroken]),
        );
      }
      case 'SOURCES': {
        const found = await this.db.source.findMany({
          where: this.sourceWhere(filter),
          take: limit,
          orderBy: { name: 'asc' },
          select: { id: true, name: true, publisher: true, method: true, active: true },
        });
        return table(
          ['id', 'name', 'publisher', 'method', 'active'],
          found.map((row) => [row.id, row.name, row.publisher, row.method, row.active]),
        );
      }
      case 'CORRECTIONS': {
        const found = await this.db.correction.findMany({
          where: this.correctionWhere(filter),
          take: limit,
          orderBy: { createdAt: 'asc' },
          select: { id: true, status: true, entityType: true, entityId: true, field: true, createdAt: true },
        });
        return table(
          ['id', 'status', 'entityType', 'entityId', 'field', 'createdAt'],
          found.map((row) => [row.id, row.status, row.entityType, row.entityId, row.field, row.createdAt]),
        );
      }
      case 'ALERTS': {
        const found = await this.db.alert.findMany({
          where: this.alertWhere(filter),
          take: limit,
          orderBy: { createdAt: 'desc' },
          select: { id: true, title: true, status: true, recipientCount: true, createdAt: true },
        });
        return table(
          ['id', 'title', 'status', 'recipientCount', 'createdAt'],
          found.map((row) => [row.id, row.title, row.status, row.recipientCount, row.createdAt]),
        );
      }
      default:
        return { headers: [], rows: [] };
    }
  }

  private jurisdictionWhere(filter: Record<string, string>): Prisma.JurisdictionWhereInput {
    const where: Prisma.JurisdictionWhereInput = {};
    if (filter.status) where.status = filter.status as NonNullable<Prisma.JurisdictionWhereInput['status']>;
    if (filter.level) where.level = filter.level as NonNullable<Prisma.JurisdictionWhereInput['level']>;
    if (filter.q) where.name = { contains: filter.q, mode: 'insensitive' };
    return where;
  }

  private officeWhere(filter: Record<string, string>): Prisma.OfficeWhereInput {
    const where: Prisma.OfficeWhereInput = {};
    if (filter.status) where.status = filter.status as NonNullable<Prisma.OfficeWhereInput['status']>;
    if (filter.q) where.name = { contains: filter.q, mode: 'insensitive' };
    return where;
  }

  private officialWhere(filter: Record<string, string>): Prisma.OfficialWhereInput {
    const where: Prisma.OfficialWhereInput = {};
    if (filter.status) where.status = filter.status as NonNullable<Prisma.OfficialWhereInput['status']>;
    if (filter.q) where.fullName = { contains: filter.q, mode: 'insensitive' };
    return where;
  }

  private serviceWhere(filter: Record<string, string>): Prisma.ServiceWhereInput {
    const where: Prisma.ServiceWhereInput = {};
    if (filter.status) where.status = filter.status as NonNullable<Prisma.ServiceWhereInput['status']>;
    if (filter.q) where.title = { contains: filter.q, mode: 'insensitive' };
    return where;
  }

  private sourceWhere(filter: Record<string, string>): Prisma.SourceWhereInput {
    const where: Prisma.SourceWhereInput = {};
    if (filter.q) where.name = { contains: filter.q, mode: 'insensitive' };
    return where;
  }

  private correctionWhere(filter: Record<string, string>): Prisma.CorrectionWhereInput {
    const where: Prisma.CorrectionWhereInput = {};
    if (filter.status) where.status = filter.status as NonNullable<Prisma.CorrectionWhereInput['status']>;
    return where;
  }

  private alertWhere(filter: Record<string, string>): Prisma.AlertWhereInput {
    const where: Prisma.AlertWhereInput = {};
    if (filter.status) where.status = filter.status as NonNullable<Prisma.AlertWhereInput['status']>;
    return where;
  }
}

function table(
  headers: string[],
  rows: Array<Array<string | number | boolean | Date | null>>,
): { headers: string[]; rows: string[][] } {
  return {
    headers,
    rows: rows.map((row) => row.map((value) => exportCell(value))),
  };
}
