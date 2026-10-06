import { importPKCS8, SignJWT } from 'jose';
import { discovery, type ClientAuth, type Configuration } from 'openid-client';
import { env } from '../../config/env.js';
import type { Clock } from '../../lib/clock.js';
import { systemClock } from '../../lib/clock.js';
import type { RandomSource } from '../../lib/random.js';
import { OAuthCodeFlow, type OAuthCompleteInput } from './flow.js';
import { OpenIdClient } from './google.js';
import type { OAuthStart, OidcClient, VerifiedIdentity } from './types.js';

export const APPLE_ISSUER = 'https://appleid.apple.com';
const SECRET_TTL_SEC = 5 * 60;

export interface AppleSecretMaterial {
  teamId: string;
  keyId: string;
  clientId: string;
  privateKeyPem: string;
}

export class AppleClientSecret {
  private cached: { jwt: string; exp: number } | undefined;

  constructor(
    private readonly material: AppleSecretMaterial,
    private readonly clock: Clock = systemClock,
  ) {}

  async current(): Promise<string> {
    const now = this.clock.now();
    const nowSec = Math.floor(now.getTime() / 1000);
    if (this.cached && this.cached.exp > nowSec + 60) return this.cached.jwt;
    const exp = nowSec + SECRET_TTL_SEC;
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: this.material.keyId })
      .setIssuer(this.material.teamId)
      .setIssuedAt(nowSec)
      .setExpirationTime(exp)
      .setAudience(APPLE_ISSUER)
      .setSubject(this.material.clientId)
      .sign(await importPKCS8(this.material.privateKeyPem, 'ES256'));
    this.cached = { jwt, exp };
    return jwt;
  }
}

export function appleDisplayName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return undefined;
    const name = (parsed as { name?: { firstName?: unknown; lastName?: unknown } }).name;
    if (!name) return undefined;
    const first = typeof name.firstName === 'string' ? name.firstName.trim() : '';
    const last = typeof name.lastName === 'string' ? name.lastName.trim() : '';
    const full = `${first} ${last}`.trim();
    return full.length > 0 ? full.slice(0, 60) : undefined;
  } catch {
    return undefined;
  }
}

export interface AppleOidcOptions {
  discoveryUrl?: string;
  clientId?: string;
  secret?: AppleClientSecret;
}

export async function createAppleOidc(options?: AppleOidcOptions): Promise<OidcClient> {
  const clientId = options?.clientId ?? env.APPLE_CLIENT_ID;
  const secret =
    options?.secret ??
    new AppleClientSecret({
      teamId: env.APPLE_TEAM_ID,
      keyId: env.APPLE_KEY_ID,
      clientId,
      privateKeyPem: env.APPLE_PRIVATE_KEY,
    });
  const holder = { value: '' };
  const auth: ClientAuth = (_server, _client, body) => {
    body.set('client_id', clientId);
    body.set('client_secret', holder.value);
  };
  const config: Configuration = await discovery(
    new URL(options?.discoveryUrl ?? APPLE_ISSUER),
    clientId,
    undefined,
    auth,
  );
  config.timeout = 10;
  return new OpenIdClient(config, async () => {
    holder.value = await secret.current();
  });
}

export interface AppleOAuthOptions {
  issuer?: string;
  audience?: string;
  clock?: Clock;
  random?: RandomSource;
}

export class AppleOAuth {
  private readonly flow: OAuthCodeFlow;

  constructor(client: OidcClient, options?: AppleOAuthOptions) {
    this.flow = new OAuthCodeFlow({
      client,
      provider: 'APPLE',
      issuer: options?.issuer ?? APPLE_ISSUER,
      audience: options?.audience ?? env.APPLE_CLIENT_ID,
      scope: 'name email',
      responseMode: 'form_post',
      readName: appleDisplayName,
      ...(options?.clock ? { clock: options.clock } : {}),
      ...(options?.random ? { random: options.random } : {}),
    });
  }

  begin(redirectUri: string): Promise<OAuthStart> {
    return this.flow.begin(redirectUri);
  }

  complete(input: OAuthCompleteInput): Promise<VerifiedIdentity> {
    return this.flow.complete(input);
  }
}
