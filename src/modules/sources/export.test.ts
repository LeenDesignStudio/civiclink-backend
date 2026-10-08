import { describe, expect, it } from 'vitest';
import { Authz } from '../../authz/authz.js';
import type { ServiceContext } from '../../graphql/context.js';
import { ExportService, prefixCsvCell, toCsv } from './export.js';
import { MemoryExportStore } from './export.store.js';

describe('csv injection prefix', () => {
  it('prefixes cells that start with = + - or @', () => {
    expect(prefixCsvCell('=cmd')).toBe("'=cmd");
    expect(prefixCsvCell('+1')).toBe("'+1");
    expect(prefixCsvCell('-1')).toBe("'-1");
    expect(prefixCsvCell('@sum')).toBe("'@sum");
    expect(prefixCsvCell('Mayor')).toBe('Mayor');
    expect(toCsv(['name'], [['=HYPERLINK("x")']])).toContain("'=HYPERLINK");
  });

  it('stores a development export and returns a same-host download URL', async () => {
    const store = new MemoryExportStore();
    const service = new ExportService({
      reader: {
        count: () => Promise.resolve(1),
        rows: () => Promise.resolve({ headers: ['name'], rows: [['=Mayor']] }),
      },
      store,
      audit: { record: () => Promise.resolve() },
    });
    const principal = { kind: 'admin' as const, adminId: 'admin-1', role: 'VIEWER' as const, sessionId: 'session-1' };
    const ctx: ServiceContext = {
      requestId: 'req-1',
      principal,
      authz: new Authz(principal),
      ipHash: 'hash',
    };
    const result = await service.exportCsv(ctx, { list: 'OFFICES' }, 'https://civic.leenterminal.com');
    expect(result.url.startsWith('https://civic.leenterminal.com/dev/exports/')).toBe(true);
    const token = decodeURIComponent(result.url.slice(result.url.lastIndexOf('/') + 1));
    const file = store.read(token);
    expect(new TextDecoder().decode(file?.body ?? new Uint8Array())).toContain("'=Mayor");
  });
});
