import { describe, expect, it } from 'vitest';
import { upsertEnvLines } from './env-file.js';

describe('upsertEnvLines', () => {
  it('replaces a key, keeps comments, and appends a new key', () => {
    const next = upsertEnvLines('# keep me\nGOOGLE_MAPS_API_KEY=old\nPORT=4000\n', {
      GOOGLE_MAPS_API_KEY: 'new-key',
      STRIPE_SECRET_KEY: 'sk_test_value',
    });
    expect(next).toBe(
      '# keep me\nGOOGLE_MAPS_API_KEY="new-key"\nPORT=4000\nSTRIPE_SECRET_KEY="sk_test_value"\n',
    );
  });

  it('escapes newlines in a private key', () => {
    const next = upsertEnvLines('', { APPLE_PRIVATE_KEY: '-----BEGIN-----\nsecret\n-----END-----' });
    expect(next).toContain('APPLE_PRIVATE_KEY="-----BEGIN-----\\nsecret\\n-----END-----"');
    expect(next).not.toContain('\nsecret\n');
  });
});
