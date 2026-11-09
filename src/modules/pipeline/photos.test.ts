import { describe, expect, it } from 'vitest';
import { checkPhoto, congressPhotoUrl, httpsPhotoUrl } from './photos.js';
import type { HttpFetcher } from './types.js';

function headFetcher(status: number): HttpFetcher {
  return {
    get: () => Promise.reject(new Error('unused')),
    head: () => Promise.resolve({ status }),
  };
}

describe('official photos', () => {
  it('builds the public-domain congress portrait and rejects a bioguide with a path', () => {
    expect(congressPhotoUrl('S000001')).toBe('https://theunitedstates.io/images/congress/225x275/S000001.jpg');
    expect(congressPhotoUrl('../etc')).toBeNull();
  });

  it('keeps only https URLs', () => {
    expect(httpsPhotoUrl('https://example.gov/ada.jpg')).toBe('https://example.gov/ada.jpg');
    expect(httpsPhotoUrl('http://example.gov/ada.jpg')).toBeNull();
    expect(httpsPhotoUrl('not a url')).toBeNull();
  });

  it('clears a photo when HEAD says it is missing and keeps one that answers', async () => {
    await expect(checkPhoto(headFetcher(200), 'https://example.gov/ada.jpg')).resolves.toEqual({
      photoUrl: 'https://example.gov/ada.jpg',
      photoStatus: 'OK',
    });
    await expect(checkPhoto(headFetcher(404), 'https://example.gov/missing.jpg')).resolves.toEqual({
      photoUrl: null,
      photoStatus: 'BROKEN',
    });
    await expect(checkPhoto(headFetcher(405), 'https://example.gov/ada.jpg')).resolves.toEqual({
      photoUrl: 'https://example.gov/ada.jpg',
      photoStatus: 'OK',
    });
  });

  it('leaves an unchecked https URL in place when the run cannot HEAD', async () => {
    const fetch: HttpFetcher = { get: () => Promise.reject(new Error('unused')) };
    await expect(checkPhoto(fetch, 'https://example.gov/ada.jpg')).resolves.toEqual({
      photoUrl: 'https://example.gov/ada.jpg',
      photoStatus: 'NONE',
    });
    await expect(checkPhoto(fetch, null)).resolves.toEqual({ photoUrl: null, photoStatus: 'NONE' });
  });
});
