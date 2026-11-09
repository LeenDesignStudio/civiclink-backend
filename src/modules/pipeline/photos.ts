import type { HttpFetcher } from './types.js';

/** Public-domain congressional portraits. The frontend allows this host in images.remotePatterns and CSP img-src. */
export const CONGRESS_PHOTO_HOST = 'theunitedstates.io';

export const CONGRESS_PHOTO_ORIGIN = 'https://theunitedstates.io';

/**
 * State portraits use the https URL in the Open States `image` column.
 * That host is not fixed. Documented so the frontend can allow it the same way.
 */
export const OPENSTATES_IMAGE_NOTE =
  'Open States image URLs are the https value of the CSV image column. Allow those hosts in next.config images.remotePatterns and CSP img-src.';

export type StoredPhotoStatus = 'NONE' | 'OK' | 'BROKEN';

export function congressPhotoUrl(bioguide: string): string | null {
  if (!/^[A-Za-z0-9]{1,16}$/.test(bioguide)) return null;
  return `${CONGRESS_PHOTO_ORIGIN}/images/congress/225x275/${bioguide}.jpg`;
}

/** https only. Anything else is unpublished. */
export function httpsPhotoUrl(value: string | null | undefined): string | null {
  const text = value?.trim() ?? '';
  if (!text || text.length > 2048) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export interface CheckedPhoto {
  photoUrl: string | null;
  photoStatus: StoredPhotoStatus;
}

/**
 * HEAD the image. 2xx is kept. 405/501 means the host does not implement HEAD, so the URL is kept.
 * A missing image or a failed request is stored as BROKEN with a null URL.
 * When the fetcher cannot HEAD, the https URL is kept and the status stays NONE until a source run checks it.
 */
export async function checkPhoto(fetch: HttpFetcher, value: string | null): Promise<CheckedPhoto> {
  const photoUrl = httpsPhotoUrl(value);
  if (!photoUrl) return { photoUrl: null, photoStatus: 'NONE' };
  if (!fetch.head) return { photoUrl, photoStatus: 'NONE' };
  let status = 0;
  try {
    const response = await fetch.head(photoUrl, {
      timeoutMs: 8_000,
      headers: { 'user-agent': 'CivicLinkBot/1.0' },
    });
    status = response.status;
  } catch {
    status = 0;
  }
  if ((status >= 200 && status < 300) || status === 405 || status === 501) {
    return { photoUrl, photoStatus: 'OK' };
  }
  return { photoUrl: null, photoStatus: 'BROKEN' };
}
