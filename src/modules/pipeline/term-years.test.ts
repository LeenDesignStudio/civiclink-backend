import { describe, expect, it } from 'vitest';
import { electedYearByTerm, firstElectedYear, parseTermHistory, yearOf } from './term-years.js';

describe('elected year', () => {
  it('uses the earliest continuous start on the same office', () => {
    const years = electedYearByTerm([
      { key: 'a', officeKey: 'seat', start: '2019-01-09', end: '2023-01-10' },
      { key: 'b', officeKey: 'seat', start: '2023-01-11', end: '2027-01-13' },
    ]);
    expect(years.get('a')).toBe(2019);
    expect(years.get('b')).toBe(2019);
  });

  it('starts a new run after a gap and keeps the earlier run on its own term', () => {
    const years = electedYearByTerm([
      { key: 'old', officeKey: 'seat', start: '2010-01-01', end: '2014-01-01' },
      { key: 'now', officeKey: 'seat', start: '2018-01-01', end: null },
    ]);
    expect(years.get('old')).toBe(2010);
    expect(years.get('now')).toBe(2018);
  });

  it('does not guess a year when the source published no start date', () => {
    const years = electedYearByTerm([
      { key: 'blank', officeKey: 'seat', start: null, end: null },
      { key: 'other', officeKey: 'other', start: '2020-01-01', end: null },
    ]);
    expect(years.get('blank')).toBeNull();
    expect(years.get('other')).toBe(2020);
    expect(yearOf('2020')).toBeNull();
    expect(yearOf(null)).toBeNull();
  });

  it('takes the earliest known year across offices', () => {
    expect(firstElectedYear([null, '2015-01-03', '2007-01-04'])).toBe(2007);
    expect(firstElectedYear([null, undefined, ''])).toBeNull();
  });

  it('drops history rows that are not a seat', () => {
    expect(parseTermHistory('not json')).toEqual([]);
    expect(parseTermHistory(JSON.stringify([{ officeKey: 'seat:cd:2408', start: '2013-01-03', end: 'nope' }]))).toEqual([
      {
        officeKey: 'seat:cd:2408',
        officeName: 'Office',
        jurisdictionType: '',
        jurisdictionGeoid: '',
        seatLabel: null,
        start: '2013-01-03',
        end: null,
      },
    ]);
  });
});
