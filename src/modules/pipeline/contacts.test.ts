import { describe, expect, it } from 'vitest';
import { firstHttps, parsePublishedAddress, reviewEmail } from './contacts.js';

describe('contact review', () => {
  it('publishes a name match or an office mailbox and holds a foreign personal mailbox', () => {
    expect(reviewEmail('ada.lovelace@senate.md.gov', 'Ada Lovelace')).toEqual({
      publish: 'ada.lovelace@senate.md.gov',
      review: null,
    });
    expect(reviewEmail('info@senate.md.gov', 'Ada Lovelace')).toEqual({ publish: 'info@senate.md.gov', review: null });
    expect(reviewEmail('tim.czmowski@example.gov', 'Aaron Aylward')).toEqual({
      publish: null,
      review: 'tim.czmowski@example.gov',
    });
    expect(reviewEmail('jared.solomon@example.gov', 'Aaron Kaufman')).toEqual({
      publish: null,
      review: 'jared.solomon@example.gov',
    });
  });

  it('splits a capitol line and keeps the first https link', () => {
    expect(parsePublishedAddress('100 State Circle, Annapolis, MD 21401', 'MD')).toEqual({
      street: '100 State Circle',
      city: 'Annapolis',
      state: 'MD',
      zip: '21401',
    });
    expect(firstHttps('[{"url":"https://example.gov/ada"}]')).toBe('https://example.gov/ada');
  });
});
