import { describe, expect, it } from 'vitest';
import {
  GENERATED_CODE_LENGTH,
  generateCode,
  isReservedCode,
  isValidCode,
} from '../../src/modules/links/link-code.js';

describe('generateCode', () => {
  it('produces base62 codes of the default length', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateCode()).toMatch(new RegExp(`^[0-9A-Za-z]{${GENERATED_CODE_LENGTH}}$`));
    }
  });

  it('honours a custom length', () => {
    expect(generateCode(12)).toHaveLength(12);
  });

  it('does not repeat in a realistic sample', () => {
    const codes = new Set(Array.from({ length: 20_000 }, () => generateCode()));
    expect(codes.size).toBe(20_000);
  });

  it('uses every part of the alphabet without obvious bias', () => {
    const counts = new Map();
    for (let i = 0; i < 20_000; i++) {
      for (const char of generateCode()) counts.set(char, (counts.get(char) ?? 0) + 1);
    }
    expect(counts.size).toBe(62);

    // 140k characters over 62 symbols: expect ~2258 each. Allow a wide margin to stay non-flaky.
    const values = [...counts.values()];
    expect(Math.min(...values)).toBeGreaterThan(1800);
    expect(Math.max(...values)).toBeLessThan(2750);
  });
});

describe('isValidCode', () => {
  it.each(['abc', 'My-Alias_1', 'a'.repeat(32)])('accepts %s', (code) => {
    expect(isValidCode(code)).toBe(true);
  });

  it.each(['ab', 'a'.repeat(33), 'has space', 'dot.ted', 'slash/es', 'ünï', ''])(
    'rejects %j',
    (code) => {
      expect(isValidCode(code)).toBe(false);
    },
  );
});

describe('isReservedCode', () => {
  it.each(['api', 'DOCS', 'Health', 'metrics', 'assets', 'admin'])('reserves %s', (code) => {
    expect(isReservedCode(code)).toBe(true);
  });

  it('does not reserve ordinary words', () => {
    expect(isReservedCode('my-blog')).toBe(false);
  });
});
