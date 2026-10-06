import type { ServiceContext } from '../../graphql/context.js';
import { ExportTooLargeError, fromZod, ValidationError } from '../../lib/errors.js';
import { z } from 'zod';
import type { ActorType } from '../../generated/prisma/enums.js';

export const EXPORT_MAX_ROWS = 50_000;
const DANGEROUS = /^[=+\-@]/;

export type ExportList =
  | 'JURISDICTIONS'
  | 'OFFICES'
  | 'OFFICIALS'
  | 'SERVICES'
  | 'SOURCES'
  | 'CORRECTIONS'
  | 'ALERTS';

export interface ObjectStore {
  put(input: { key: string; body: Uint8Array; contentType: string }): Promise<void>;
  presign(key: string, expiresSeconds: number): Promise<string>;
}

export interface ExportReader {
  count(list: ExportList, filter: Record<string, string>): Promise<number>;
  rows(list: ExportList, filter: Record<string, string>, limit: number): Promise<{ headers: string[]; rows: string[][] }>;
}

export interface ExportAudit {
  record(
    tx: unknown,
    entry: {
      actorType: ActorType;
      actorId: string | null;
      entityType: string;
      entityId: string;
      action: string;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
      requestId: string | null;
    },
  ): Promise<void>;
}

const schema = z
  .object({
    list: z.enum(['JURISDICTIONS', 'OFFICES', 'OFFICIALS', 'SERVICES', 'SOURCES', 'CORRECTIONS', 'ALERTS']),
    filter: z.record(z.string().max(40), z.string().max(100)).optional(),
  })
  .strict();

export function prefixCsvCell(value: string): string {
  return DANGEROUS.test(value) ? `'${value}` : value;
}

export function escapeCsvCell(value: string): string {
  const safe = prefixCsvCell(value);
  if (/[",\r\n]/.test(safe)) return `"${safe.replaceAll('"', '""')}"`;
  return safe;
}

export function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) lines.push(row.map((cell) => escapeCsvCell(cell)).join(','));
  return `${lines.join('\n')}\n`;
}

export class ExportService {
  constructor(
    private readonly deps: {
      reader: ExportReader;
      store: ObjectStore;
      audit: ExportAudit;
      withTx?: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
    },
  ) {}

  async exportCsv(ctx: ServiceContext, input: unknown): Promise<{ url: string }> {
    ctx.authz.require('admin.export:csv');
    const admin = ctx.authz.requireAdmin();
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw fromZod(parsed.error);
    const filter = parsed.data.filter ?? {};
    const count = await this.deps.reader.count(parsed.data.list, filter);
    if (count > EXPORT_MAX_ROWS) throw new ExportTooLargeError();
    const table = await this.deps.reader.rows(parsed.data.list, filter, EXPORT_MAX_ROWS);
    if (table.rows.length > EXPORT_MAX_ROWS) throw new ExportTooLargeError();
    const csv = toCsv(table.headers, table.rows);
    const key = `exports/${parsed.data.list.toLowerCase()}-${Date.now()}.csv`;
    await this.deps.store.put({
      key,
      body: new TextEncoder().encode(csv),
      contentType: 'text/csv; charset=utf-8',
    });
    const url = await this.deps.store.presign(key, 600);
    const run = this.deps.withTx ?? ((fn) => fn(undefined));
    await run(async (tx) => {
      await this.deps.audit.record(tx, {
        actorType: 'ADMIN',
        actorId: admin.adminId,
        entityType: 'export',
        entityId: admin.adminId,
        action: 'export.csv',
        before: null,
        after: { list: parsed.data.list, rows: table.rows.length },
        requestId: ctx.requestId,
      });
    });
    if (!url.startsWith('https://') && !url.startsWith('http://')) {
      throw new ValidationError('Export link was not created.');
    }
    return { url };
  }
}
