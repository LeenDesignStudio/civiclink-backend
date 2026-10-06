import { describe, expect, it } from 'vitest';
import { prefixCsvCell, toCsv } from './export.js';

describe('csv injection prefix', () => {
  it('prefixes cells that start with = + - or @', () => {
    expect(prefixCsvCell('=cmd')).toBe("'=cmd");
    expect(prefixCsvCell('+1')).toBe("'+1");
    expect(prefixCsvCell('-1')).toBe("'-1");
    expect(prefixCsvCell('@sum')).toBe("'@sum");
    expect(prefixCsvCell('Mayor')).toBe('Mayor');
    expect(toCsv(['name'], [['=HYPERLINK("x")']])).toContain("'=HYPERLINK");
  });
});
