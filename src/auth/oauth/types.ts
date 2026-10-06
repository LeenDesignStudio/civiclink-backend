export interface IdClaims {
  iss: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  nonce?: string;
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  hd?: string;
  name?: string;
}

export interface AuthorizationParams {
  state: string;
  nonce: string;
  codeChallenge: string;
  redirectUri: string;
  scope: string;
  responseMode?: 'form_post';
  hostedDomain?: string;
}

export interface ExchangeParams {
  code: string;
  redirectUri: string;
  codeVerifier: string;
  expectedState: string;
  expectedNonce: string;
  currentUrl: URL;
  method: 'GET' | 'POST';
}

export interface OidcClient {
  authorizationUrl(params: AuthorizationParams): URL;
  exchange(params: ExchangeParams): Promise<{ idToken: string; claims: IdClaims }>;
}

export interface VerifiedIdentity {
  provider: 'GOOGLE' | 'APPLE';
  subject: string;
  email: string;
  emailVerified: true;
  hd?: string;
  name?: string;
}

export interface OAuthStart {
  url: URL;
  state: string;
  nonce: string;
  codeVerifier: string;
}
