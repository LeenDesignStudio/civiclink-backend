import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { Authz } from '../../authz/authz.js';
import type { ServiceContext } from '../../graphql/context.js';
import { ExportService, prefixCsvCell, toCsv } from './export.js';
import { MemoryExportStore, S3ExportStore } from './export.store.js';

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

describe('S3 export encryption', () => {
  function fakeClient(): { client: S3Client; sent: PutObjectCommand[] } {
    const sent: PutObjectCommand[] = [];
    const client = {
      send: (command: PutObjectCommand) => {
        sent.push(command);
        return Promise.resolve({});
      },
    } as unknown as S3Client;
    return { client, sent };
  }

  const body = new TextEncoder().encode('name\nMayor\n');

  it('sends aws:kms and the key id when S3_EXPORTS_KMS_KEY_ID is set', async () => {
    const { client, sent } = fakeClient();
    const store = new S3ExportStore('exports', 'us-east-1', 'arn:aws:kms:us-east-1:123:key/abc', client);
    await store.put({ key: 'file.csv', body, contentType: 'text/csv' });
    expect(sent[0]?.input).toMatchObject({
      Bucket: 'exports',
      Key: 'exports/file.csv',
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: 'arn:aws:kms:us-east-1:123:key/abc',
    });
  });

  it('falls back to AES256 when no KMS key id is configured', async () => {
    const { client, sent } = fakeClient();
    const store = new S3ExportStore('exports', 'us-east-1', undefined, client);
    await store.put({ key: 'file.csv', body, contentType: 'text/csv' });
    expect(sent[0]?.input.ServerSideEncryption).toBe('AES256');
    expect(sent[0]?.input.SSEKMSKeyId).toBeUndefined();
  });
});
