import { describe, expect, it } from 'vitest';

// Every source file (except tests), as raw text.
const sources = import.meta.glob(['./**/*.{js,jsx}', '!./**/*.test.{js,jsx}', '!./test/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('client source hygiene', () => {
  it('finds the source files to check', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(15);
  });

  it('never injects HTML or evaluates strings: link URLs and aliases are user input', () => {
    const forbidden =
      /dangerouslySetInnerHTML|\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write|\beval\(|new Function\(/;

    const offenders = Object.entries(sources)
      .filter(([, code]) => forbidden.test(code))
      .map(([file]) => file);

    expect(offenders).toEqual([]);
  });

  it('keeps the auth token out of URLs', () => {
    const offenders = Object.entries(sources)
      .filter(([, code]) => /[?&]token=/.test(code))
      .map(([file]) => file);

    expect(offenders).toEqual([]);
  });
});
