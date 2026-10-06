import { decodeJwt } from 'jose';
import { describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import { FakeClock } from '../../lib/clock.js';
import { OauthFailedError } from '../../lib/errors.js';
import { FakeRandom } from '../../lib/random.js';
import { AppleClientSecret, AppleOAuth, APPLE_ISSUER, appleDisplayName } from './apple.js';
import { pkceS256 } from './pkce.js';
import { GoogleOAuth, GOOGLE_ISSUER } from './google.js';
import type { AuthorizationParams, ExchangeParams, IdClaims, OidcClient } from './types.js';

class FakeOidc implements OidcClient {
  lastAuth: AuthorizationParams | undefined;
  claims: IdClaims | undefined;

  authorizationUrl(params: AuthorizationParams): URL {
    this.lastAuth = params;
    const url = new URL('https://issuer.test/authorize');
    url.searchParams.set('scope', params.scope);
    return url;
  }

  exchange(_params: ExchangeParams): Promise<{ idToken: string; claims: IdClaims }> {
    if (!this.claims) throw new Error('missing claims');
    return Promise.resolve({ idToken: 'header.payload.sig', claims: this.claims });
  }
}

function claims(now: Date, nonce: string, extra?: Partial<IdClaims>): IdClaims {
  const sec = Math.floor(now.getTime() / 1000);
  return {
    iss: GOOGLE_ISSUER,
    aud: 'aud-1',
    exp: sec + 300,
    iat: sec,
    nonce,
    sub: 'subject-1',
    email: 'ada@example.com',
    email_verified: true,
    ...extra,
  };
}

describe('oauth', () => {
  const now = new Date('2026-04-01T12:00:00.000Z');

  it('starts Google with PKCE S256 and rejects a bad nonce', async () => {
    const client = new FakeOidc();
    const google = new GoogleOAuth(client, {
      audience: 'aud-1',
      clock: new FakeClock(now),
      random: new FakeRandom(),
    });
    const start = await google.begin('https://civic.test/auth/google/callback');
    expect(client.lastAuth?.scope).toBe('openid email profile');
    expect(client.lastAuth?.codeChallenge).toBe(pkceS256(start.codeVerifier));
    expect(client.lastAuth?.responseMode).toBeUndefined();
    client.claims = claims(now, 'wrong-nonce');
    await expect(
      google.complete({
        code: 'code',
        redirectUri: 'https://civic.test/auth/google/callback',
        codeVerifier: start.codeVerifier,
        expectedState: start.state,
        expectedNonce: start.nonce,
        currentUrl: new URL('https://civic.test/auth/google/callback?code=code'),
        method: 'GET',
        queryState: start.state,
      }),
    ).rejects.toBeInstanceOf(OauthFailedError);
  });

  it('starts Apple with form_post and captures the first-login name', async () => {
    const client = new FakeOidc();
    const apple = new AppleOAuth(client, {
      audience: 'aud-1',
      clock: new FakeClock(now),
      random: new FakeRandom(),
    });
    const start = await apple.begin('https://civic.test/auth/apple/callback');
    expect(client.lastAuth?.scope).toBe('name email');
    expect(client.lastAuth?.responseMode).toBe('form_post');
    client.claims = claims(now, start.nonce, { iss: APPLE_ISSUER, email_verified: 'true' });
    const identity = await apple.complete({
      code: 'code',
      redirectUri: 'https://civic.test/auth/apple/callback',
      codeVerifier: start.codeVerifier,
      expectedState: start.state,
      expectedNonce: start.nonce,
      currentUrl: new URL('https://civic.test/auth/apple/callback'),
      method: 'POST',
      queryState: start.state,
      appleUser: JSON.stringify({ name: { firstName: 'Ada', lastName: 'Lovelace' } }),
    });
    expect(identity.name).toBe('Ada Lovelace');
    expect(identity.provider).toBe('APPLE');
    expect(appleDisplayName(undefined)).toBeUndefined();
  });

  it('rejects an unverified email', async () => {
    const client = new FakeOidc();
    const google = new GoogleOAuth(client, { audience: 'aud-1', clock: new FakeClock(now), random: new FakeRandom() });
    const start = await google.begin('https://civic.test/cb');
    client.claims = claims(now, start.nonce, { email_verified: false });
    await expect(
      google.complete({
        code: 'code',
        redirectUri: 'https://civic.test/cb',
        codeVerifier: start.codeVerifier,
        expectedState: start.state,
        expectedNonce: start.nonce,
        currentUrl: new URL('https://civic.test/cb'),
        method: 'GET',
        queryState: start.state,
      }),
    ).rejects.toBeInstanceOf(OauthFailedError);
  });

  it('caches the Apple client secret for five minutes', async () => {
    const clock = new FakeClock(now);
    const secrets = new AppleClientSecret(
      {
        teamId: env.APPLE_TEAM_ID,
        keyId: env.APPLE_KEY_ID,
        clientId: env.APPLE_CLIENT_ID,
        privateKeyPem: env.APPLE_PRIVATE_KEY,
      },
      clock,
    );
    const first = await secrets.current();
    expect(await secrets.current()).toBe(first);
    const decoded = decodeJwt(first);
    expect(decoded.iss).toBe(env.APPLE_TEAM_ID);
    expect(decoded.sub).toBe(env.APPLE_CLIENT_ID);
    expect(decoded.aud).toBe(APPLE_ISSUER);
    clock.advance(6 * 60 * 1000);
    expect(await secrets.current()).not.toBe(first);
  });
});
