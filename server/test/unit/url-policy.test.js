import { describe, expect, it } from 'vitest';
import { createUrlPolicy } from '../../src/services/url-policy.service.js';

const policy = createUrlPolicy({
  blockedDomains: ['evil.example', '.phishing.test'],
  selfHostname: 'sho.rt',
});

describe('UrlPolicy.normalize', () => {
  it('accepts ordinary http and https URLs and returns the canonical form', () => {
    expect(policy.normalize('  https://Example.com/a b?x=1#frag ')).toBe(
      'https://example.com/a%20b?x=1#frag',
    );
    expect(policy.normalize('http://example.org')).toBe('http://example.org/');
  });

  it.each([
    ['javascript:alert(1)', 'scheme'],
    ['data:text/html,<script>1</script>', 'scheme'],
    ['ftp://example.com/file', 'scheme'],
    ['file:///etc/passwd', 'scheme'],
    ['not a url', 'unparseable'],
    ['//example.com', 'relative'],
    ['https://user:pass@example.com', 'credentials'],
    ['https://user@example.com', 'credentials'],
  ])('rejects %s (%s)', (input) => {
    expect(() => policy.normalize(input)).toThrow(
      expect.objectContaining({ name: 'BadRequestError', code: 'INVALID_URL' }),
    );
  });

  it.each([
    'http://localhost',
    'http://localhost:3000/admin',
    'http://app.localhost',
    'http://127.0.0.1',
    'http://127.1',
    'http://2130706433', // decimal form of 127.0.0.1
    'http://0x7f.0.0.1',
    'http://10.1.2.3',
    'http://172.16.0.1',
    'http://172.31.255.255',
    'http://192.168.1.1',
    'http://169.254.169.254/latest/meta-data',
    'http://100.64.0.1',
    'http://0.0.0.0',
    'http://224.0.0.1',
    'http://[::1]',
    'http://[::]',
    'http://[fd00::1]',
    'http://[fe80::1]',
    'http://[::ffff:127.0.0.1]',
    'http://[::ffff:10.0.0.1]',
    'http://intranet',
    'http://printer.local',
    'http://db.internal',
  ])('blocks the private or local target %s', (input) => {
    expect(() => policy.normalize(input)).toThrow(/private|local/i);
  });

  it.each(['http://8.8.8.8', 'https://172.32.0.1', 'https://[2001:4860:4860::8888]'])(
    'allows the public address %s',
    (input) => {
      expect(() => policy.normalize(input)).not.toThrow();
    },
  );

  it('blocks configured domains and their subdomains, but not lookalikes', () => {
    expect(() => policy.normalize('https://evil.example/x')).toThrow(/not allowed/);
    expect(() => policy.normalize('https://www.evil.example')).toThrow(/not allowed/);
    expect(() => policy.normalize('https://a.b.phishing.test')).toThrow(/not allowed/);
    expect(() => policy.normalize('https://notevil.example')).not.toThrow();
  });

  it('refuses links that point back at the service itself', () => {
    expect(() => policy.normalize('https://sho.rt/abc123')).toThrow(/this service/);
    expect(() => policy.normalize('https://SHO.RT')).toThrow(/this service/);
  });

  it('enforces a maximum length', () => {
    expect(() => policy.normalize(`https://example.com/${'a'.repeat(2100)}`)).toThrow(/too long/);
  });

  it('reports failures with a stable error code', () => {
    try {
      policy.normalize('ftp://x.com');
      expect.unreachable();
    } catch (err) {
      expect(err).toMatchObject({ statusCode: 400, code: 'INVALID_URL' });
    }
  });
});
