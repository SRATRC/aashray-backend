import { compareVersions, isAtLeast } from '../utils/versionCompare.js';

describe('compareVersions', () => {
  it('compares segments numerically, not lexically', () => {
    expect(compareVersions('10', '4')).toBe(1);
    expect(compareVersions('4', '10')).toBe(-1);
    expect(compareVersions('2.10.0', '2.9.9')).toBe(1);
  });

  it('treats missing trailing segments as zero', () => {
    expect(compareVersions('2.1', '2.1.0')).toBe(0);
    expect(compareVersions('16', '16.0.0')).toBe(0);
    expect(compareVersions('16.3.1', '16.3')).toBe(1);
  });

  it('reports equality', () => {
    expect(compareVersions('13', '13')).toBe(0);
    expect(compareVersions('2.5.0', '2.5.0')).toBe(0);
  });

  it('handles both orderings', () => {
    expect(compareVersions('17.0', '16.9')).toBe(1);
    expect(compareVersions('16.9', '17.0')).toBe(-1);
  });

  it('ignores non-numeric suffixes on a segment', () => {
    expect(compareVersions('2.1.0-beta', '2.1.0')).toBe(0);
  });

  it('accepts numeric input', () => {
    expect(compareVersions(13, 12)).toBe(1);
  });

  it('returns null for unparseable or empty input', () => {
    expect(compareVersions('', '5')).toBeNull();
    expect(compareVersions('abc', '1')).toBeNull();
    expect(compareVersions(null, '1')).toBeNull();
    expect(compareVersions(undefined, '1')).toBeNull();
    expect(compareVersions('1', 'unknown')).toBeNull();
  });
});

describe('isAtLeast', () => {
  it('is true when a >= b', () => {
    expect(isAtLeast('13', '12')).toBe(true);
    expect(isAtLeast('12', '12')).toBe(true);
  });

  it('is false when a < b or inputs are unparseable', () => {
    expect(isAtLeast('11', '12')).toBe(false);
    expect(isAtLeast('bad', '12')).toBe(false);
  });
});
