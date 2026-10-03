import { describe, expect, it } from 'vitest';
import { SHORT_CODE_LENGTH } from '../../src/constants.js';
import {
  generateShortCode,
  isReservedShortCode,
  isValidShortCode,
} from '../../src/utils/short-code.js';

describe('generateShortCode', () => {
  it('produces base62 codes of the default length', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateShortCode()).toMatch(new RegExp(`^[0-9A-Za-z]{${SHORT_CODE_LENGTH}}$`));
    }
  });

  it('honours a custom length', () => {
    expect(generateShortCode(12)).toHaveLength(12);
  });

  it('does not repeat in a realistic sample', () => {
    const codes = new Set(Array.from({ length: 20_000 }, () => generateShortCode()));
    expect(codes.size).toBe(20_000);
  });

  it('uses every part of the alphabet without obvious bias', () => {
    const counts = new Map();
    for (let i = 0; i < 20_000; i++) {
      for (const char of generateShortCode()) counts.set(char, (counts.get(char) ?? 0) + 1);
    }
    expect(counts.size).toBe(62);

    // 140k characters over 62 symbols: expect ~2258 each. Allow a wide margin to stay non-flaky.
    const values = [...counts.values()];
    expect(Math.min(...values)).toBeGreaterThan(1800);
    expect(Math.max(...values)).toBeLessThan(2750);
  });
});

describe('isValidShortCode', () => {
  it.each(['abc', 'My-Alias_1', 'a'.repeat(32)])('accepts %s', (code) => {
    expect(isValidShortCode(code)).toBe(true);
  });

  it.each(['ab', 'a'.repeat(33), 'has space', 'dot.ted', 'slash/es', 'ünï', ''])(
    'rejects %j',
    (code) => {
      expect(isValidShortCode(code)).toBe(false);
    },
  );
});

describe('isReservedShortCode', () => {
  it.each(['api', 'DOCS', 'Health', 'metrics', 'assets', 'admin'])('reserves %s', (code) => {
    expect(isReservedShortCode(code)).toBe(true);
  });

  it('does not reserve ordinary words', () => {
    expect(isReservedShortCode('my-blog')).toBe(false);
  });
});
