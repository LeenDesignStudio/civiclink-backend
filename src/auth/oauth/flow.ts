import type { Clock } from '../../lib/clock.js';
import { systemClock } from '../../lib/clock.js';
import type { RandomSource } from '../../lib/random.js';
import { systemRandom } from '../../lib/random.js';
import { OauthFailedError } from '../../lib/errors.js';
import { assertIdClaims, toVerifiedIdentity } from './claims.js';
import { pkceS256 } from './pkce.js';
import type {
  IdClaims,
  OAuthStart,
  OidcClient,
  VerifiedIdentity,
} from './types.js';

export interface OAuthFlowOptions {
  client: OidcClient;
  provider: 'GOOGLE' | 'APPLE';
  issuer: string;
  audience: string;
  scope: string;
  responseMode?: 'form_post';
  hostedDomain?: string;
  clock?: Clock;
  random?: RandomSource;
  readName?: (appleUser: string | undefined) => string | undefined;
}

export interface OAuthCompleteInput {
  code: string;
  redirectUri: string;
  codeVerifier: string;
  expectedState: string;
  expectedNonce: string;
  currentUrl: URL;
  method: 'GET' | 'POST';
  queryState: string;
  appleUser?: string;
}

export class OAuthCodeFlow {
  private readonly clock: Clock;
  private readonly random: RandomSource;

  constructor(private readonly options: OAuthFlowOptions) {
    this.clock = options.clock ?? systemClock;
    this.random = options.random ?? systemRandom;
  }

  async begin(redirectUri: string): Promise<OAuthStart> {
    const state = this.random.token(16);
    const nonce = this.random.token(16);
    const codeVerifier = this.random.token(48);
    const url = this.options.client.authorizationUrl({
      state,
      nonce,
      codeChallenge: pkceS256(codeVerifier),
      redirectUri,
      scope: this.options.scope,
      ...(this.options.responseMode ? { responseMode: this.options.responseMode } : {}),
      ...(this.options.hostedDomain ? { hostedDomain: this.options.hostedDomain } : {}),
    });
    return { url, state, nonce, codeVerifier };
  }

  async complete(input: OAuthCompleteInput): Promise<VerifiedIdentity> {
    if (input.queryState !== input.expectedState) {
      throw new OauthFailedError({ details: { reason: 'state' } });
    }
    let exchanged: { idToken: string; claims: IdClaims };
    try {
      exchanged = await this.options.client.exchange({
        code: input.code,
        redirectUri: input.redirectUri,
        codeVerifier: input.codeVerifier,
        expectedState: input.expectedState,
        expectedNonce: input.expectedNonce,
        currentUrl: input.currentUrl,
        method: input.method,
      });
    } catch (err) {
      if (err instanceof OauthFailedError) throw err;
      throw new OauthFailedError({ cause: err, details: { reason: 'token_exchange' } });
    }
    const now = this.clock.now();
    assertIdClaims(exchanged.claims, {
      issuer: this.options.issuer,
      audience: this.options.audience,
      nonce: input.expectedNonce,
      now,
    });
    const name = this.options.readName?.(input.appleUser);
    return toVerifiedIdentity(this.options.provider, exchanged.claims, name);
  }
}
