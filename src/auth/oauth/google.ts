import {
  authorizationCodeGrant,
  buildAuthorizationUrl,
  ClientSecretPost,
  discovery,
  type ClientAuth,
  type Configuration,
} from 'openid-client';
import { env } from '../../config/env.js';
import { OauthFailedError } from '../../lib/errors.js';
import type { Clock } from '../../lib/clock.js';
import type { RandomSource } from '../../lib/random.js';
import { OAuthCodeFlow, type OAuthCompleteInput } from './flow.js';
import type {
  AuthorizationParams,
  ExchangeParams,
  IdClaims,
  OAuthStart,
  OidcClient,
  VerifiedIdentity,
} from './types.js';

export const GOOGLE_ISSUER = 'https://accounts.google.com';

export class OpenIdClient implements OidcClient {
  constructor(
    private readonly config: Configuration,
    private readonly prepare?: () => Promise<void>,
  ) {}

  authorizationUrl(params: AuthorizationParams): URL {
    const query: Record<string, string> = {
      redirect_uri: params.redirectUri,
      scope: params.scope,
      state: params.state,
      nonce: params.nonce,
      code_challenge: params.codeChallenge,
      code_challenge_method: 'S256',
    };
    if (params.responseMode) query.response_mode = params.responseMode;
    if (params.hostedDomain) query.hd = params.hostedDomain;
    return buildAuthorizationUrl(this.config, query);
  }

  async exchange(params: ExchangeParams): Promise<{ idToken: string; claims: IdClaims }> {
    if (this.prepare) await this.prepare();
    const current =
      params.method === 'POST'
        ? new Request(params.redirectUri, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ code: params.code, state: params.expectedState }),
          })
        : params.currentUrl;
    try {
      const tokens = await authorizationCodeGrant(this.config, current, {
        pkceCodeVerifier: params.codeVerifier,
        expectedNonce: params.expectedNonce,
        expectedState: params.expectedState,
        idTokenExpected: true,
      });
      const raw = tokens.claims();
      if (!raw || !tokens.id_token) throw new OauthFailedError({ details: { reason: 'id_token' } });
      return { idToken: tokens.id_token, claims: mapClaims(raw) };
    } catch (err) {
      if (err instanceof OauthFailedError) throw err;
      throw new OauthFailedError({ cause: err, details: { reason: 'token_exchange' } });
    }
  }
}

function mapClaims(raw: object): IdClaims {
  const record = raw as Record<string, unknown>;
  const iss = typeof record.iss === 'string' ? record.iss : '';
  const sub = typeof record.sub === 'string' ? record.sub : '';
  const exp = typeof record.exp === 'number' ? record.exp : 0;
  const aud = Array.isArray(record.aud)
    ? record.aud.filter((item): item is string => typeof item === 'string')
    : typeof record.aud === 'string'
      ? record.aud
      : '';
  const claims: IdClaims = { iss, aud, exp, sub };
  if (typeof record.iat === 'number') claims.iat = record.iat;
  if (typeof record.nonce === 'string') claims.nonce = record.nonce;
  if (typeof record.email === 'string') claims.email = record.email;
  if (typeof record.email_verified === 'boolean' || typeof record.email_verified === 'string') {
    claims.email_verified = record.email_verified;
  }
  if (typeof record.hd === 'string') claims.hd = record.hd;
  if (typeof record.name === 'string') claims.name = record.name;
  return claims;
}

export interface GoogleOidcOptions {
  discoveryUrl?: string;
  clientId?: string;
  clientSecret?: string;
  clientAuth?: ClientAuth;
}

export async function createGoogleOidc(options?: GoogleOidcOptions): Promise<OidcClient> {
  const issuer = options?.discoveryUrl ?? GOOGLE_ISSUER;
  const config = await discovery(
    new URL(issuer),
    options?.clientId ?? env.GOOGLE_CLIENT_ID,
    undefined,
    options?.clientAuth ?? ClientSecretPost(options?.clientSecret ?? env.GOOGLE_CLIENT_SECRET),
  );
  config.timeout = 10;
  return new OpenIdClient(config);
}

export interface GoogleOAuthOptions {
  issuer?: string;
  audience?: string;
  hostedDomain?: string;
  clock?: Clock;
  random?: RandomSource;
}

export class GoogleOAuth {
  private readonly flow: OAuthCodeFlow;

  constructor(client: OidcClient, options?: GoogleOAuthOptions) {
    this.flow = new OAuthCodeFlow({
      client,
      provider: 'GOOGLE',
      issuer: options?.issuer ?? GOOGLE_ISSUER,
      audience: options?.audience ?? env.GOOGLE_CLIENT_ID,
      scope: 'openid email profile',
      ...(options?.hostedDomain ? { hostedDomain: options.hostedDomain } : {}),
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
