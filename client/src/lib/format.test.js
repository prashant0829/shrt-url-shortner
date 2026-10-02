import { describe, expect, it } from 'vitest';
import { bucketLabel, linkStatus, pluralize, stripProtocol, timeAgo } from './format.js';

const NOW = Date.parse('2026-06-01T12:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

describe('timeAgo', () => {
  it.each([
    [30_000, 'just now'],
    [5 * 60_000, '5 minutes ago'],
    [3 * 3_600_000, '3 hours ago'],
    [2 * 86_400_000, '2 days ago'],
  ])('%d ms ago -> %s', (ms, expected) => {
    expect(timeAgo(ago(ms), NOW)).toBe(expected);
  });

  it('also handles the future', () => {
    expect(timeAgo(new Date(NOW + 2 * 86_400_000).toISOString(), NOW)).toBe('in 2 days');
  });
});

describe('linkStatus', () => {
  it('is active for an enabled link without expiry or with a future one', () => {
    expect(linkStatus({ isActive: true, expiresAt: null }, NOW).key).toBe('active');
    expect(
      linkStatus({ isActive: true, expiresAt: new Date(NOW + 1000).toISOString() }, NOW).key,
    ).toBe('active');
  });

  it('is expired once the expiry has passed', () => {
    expect(
      linkStatus({ isActive: true, expiresAt: new Date(NOW - 1000).toISOString() }, NOW),
    ).toEqual({
      key: 'expired',
      label: 'Expired',
    });
  });

  it('is disabled when switched off, even if also expired', () => {
    expect(
      linkStatus({ isActive: false, expiresAt: new Date(NOW - 1000).toISOString() }, NOW).key,
    ).toBe('disabled');
  });
});

describe('small helpers', () => {
  it('pluralizes and groups thousands', () => {
    expect(pluralize(1, 'click')).toBe('1 click');
    expect(pluralize(0, 'click')).toBe('0 clicks');
    expect(pluralize(12345, 'click')).toBe('12,345 clicks');
  });

  it('strips the protocol for display', () => {
    expect(stripProtocol('https://short.test/abc')).toBe('short.test/abc');
    expect(stripProtocol('http://localhost:8080/x')).toBe('localhost:8080/x');
  });
});

describe('bucketLabel', () => {
  it('labels days in UTC, so viewers west of UTC do not see the previous day', () => {
    const label = bucketLabel('2026-09-29T00:00:00.000Z', 'day');
    expect(label).toContain('29');
    expect(label).not.toContain('28');
  });

  it('labels hours as a time of day', () => {
    expect(bucketLabel('2026-09-29T13:00:00.000Z', 'hour')).toMatch(/\d{1,2}:\d{2}/);
  });
});
