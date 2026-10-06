import { importPKCS8, importSPKI, jwtVerify, SignJWT, errors } from 'jose';
import { env } from '../config/env.js';
import { SessionExpiredError, UnauthenticatedError } from '../lib/errors.js';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const ACCESS_TOKEN_VERSION = 1;

export interface AccessTokenClaims {
  sub: string;
  typ: 'resident';
  sid: string;
  ver: number;
}

export interface TokenKeyMaterial {
  privateKeyPem: string;
  publicKeyPem: string;
  keyId: string;
  previousPublicKeyPem?: string;
}

const privateKeys = new Map<string, Promise<CryptoKey>>();
const publicKeys = new Map<string, Promise<CryptoKey>>();

function defaultKeys(): TokenKeyMaterial {
  return {
    privateKeyPem: env.JWT_PRIVATE_KEY,
    publicKeyPem: env.JWT_PUBLIC_KEY,
    keyId: env.JWT_KEY_ID,
    ...(env.JWT_PREVIOUS_PUBLIC_KEY ? { previousPublicKeyPem: env.JWT_PREVIOUS_PUBLIC_KEY } : {}),
  };
}

function privateKey(pem: string): Promise<CryptoKey> {
  const cached = privateKeys.get(pem);
  if (cached) return cached;
  const imported = importPKCS8(pem, 'ES256');
  privateKeys.set(pem, imported);
  return imported;
}

function publicKey(pem: string): Promise<CryptoKey> {
  const cached = publicKeys.get(pem);
  if (cached) return cached;
  const imported = importSPKI(pem, 'ES256');
  publicKeys.set(pem, imported);
  return imported;
}

export async function signAccessToken(
  claims: AccessTokenClaims,
  options?: { keys?: TokenKeyMaterial; now?: Date },
): Promise<string> {
  const keys = options?.keys ?? defaultKeys();
  const now = options?.now ?? new Date();
  const exp = Math.floor(now.getTime() / 1000) + ACCESS_TOKEN_TTL_SECONDS;
  return new SignJWT({ typ: claims.typ, sid: claims.sid, ver: claims.ver })
    .setProtectedHeader({ alg: 'ES256', kid: keys.keyId, typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(await privateKey(keys.privateKeyPem));
}

function readClaims(payload: Record<string, unknown>): AccessTokenClaims {
  if (payload.typ !== 'resident') throw new UnauthenticatedError();
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) throw new UnauthenticatedError();
  if (typeof payload.sid !== 'string' || payload.sid.length === 0) throw new UnauthenticatedError();
  if (typeof payload.ver !== 'number' || !Number.isFinite(payload.ver)) throw new UnauthenticatedError();
  return { sub: payload.sub, typ: 'resident', sid: payload.sid, ver: payload.ver };
}

async function verifyWith(
  token: string,
  pem: string,
  now: Date,
): Promise<AccessTokenClaims> {
  const result = await jwtVerify(token, await publicKey(pem), {
    algorithms: ['ES256'],
    currentDate: now,
  });
  return readClaims(result.payload);
}

export async function verifyAccessToken(
  token: string,
  options?: { keys?: TokenKeyMaterial; now?: Date },
): Promise<AccessTokenClaims> {
  const keys = options?.keys ?? defaultKeys();
  const now = options?.now ?? new Date();
  try {
    return await verifyWith(token, keys.publicKeyPem, now);
  } catch (err) {
    if (err instanceof UnauthenticatedError || err instanceof SessionExpiredError) throw err;
    if (keys.previousPublicKeyPem) {
      try {
        return await verifyWith(token, keys.previousPublicKeyPem, now);
      } catch (previousErr) {
        if (previousErr instanceof errors.JWTExpired || previousErr instanceof SessionExpiredError) {
          throw new SessionExpiredError({ cause: previousErr });
        }
        if (previousErr instanceof UnauthenticatedError) throw previousErr;
        throw new UnauthenticatedError(undefined, { cause: previousErr });
      }
    }
    if (err instanceof errors.JWTExpired) throw new SessionExpiredError({ cause: err });
    throw new UnauthenticatedError(undefined, { cause: err });
  }
}
