import { isIP } from 'node:net';
import { BadRequestError } from '../../shared/errors.js';

const MAX_URL_LENGTH = 2048;

/**
 * @typedef {object} UrlPolicyOptions
 * @property {string[]} blockedDomains Domains that cannot be shortened; subdomains are blocked as well.
 * @property {string} selfHostname Hostname of this service, so links cannot point back at the shortener itself.
 */

const invalid = (message) => new BadRequestError('INVALID_URL', message);

/**
 * Decides which destinations may be shortened. A shortener redirects strangers on the owner's
 * behalf, so it must not become a way to reach internal networks, phish with embedded
 * credentials or create redirect loops.
 */
export class UrlPolicy {
  #blocked;
  #selfHostname;

  /** @param {UrlPolicyOptions} options */
  constructor(options) {
    this.#blocked = options.blockedDomains.map((domain) => domain.toLowerCase().replace(/^\./, ''));
    this.#selfHostname = options.selfHostname.toLowerCase();
  }

  /** Returns the canonical form of `raw` or throws `INVALID_URL`. */
  normalize(raw) {
    const input = raw.trim();
    if (input.length > MAX_URL_LENGTH)
      throw invalid(`URL is too long (max ${MAX_URL_LENGTH} characters)`);

    let url;
    try {
      url = new URL(input);
    } catch {
      throw invalid('Not a valid absolute URL');
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw invalid('Only http and https URLs can be shortened');
    }
    if (url.username || url.password)
      throw invalid('URLs with embedded credentials are not allowed');

    const host = url.hostname.toLowerCase();
    if (isPrivateHost(host))
      throw invalid('URLs pointing to private or local addresses are not allowed');
    if (host === this.#selfHostname) throw invalid('Links to this service cannot be shortened');
    if (this.#isBlocked(host)) throw invalid('This domain is not allowed');

    return url.href;
  }

  #isBlocked(host) {
    return this.#blocked.some((domain) => host === domain || host.endsWith(`.${domain}`));
  }
}

function isPrivateHost(host) {
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;

  // The WHATWG parser normalises 2130706433, 0x7f.1, 017700000001 ... to dotted-quad form.
  if (isIP(host) === 4) return isPrivateIPv4(host);

  if (host.startsWith('[') && host.endsWith(']')) return isPrivateIPv6(host.slice(1, -1));

  // A public hostname always has at least two labels; "intranet" or "router" do not.
  return !host.includes('.');
}

function isPrivateIPv4(ip) {
  const [a = 0, b = 0] = ip.split('.').map(Number);
  return (
    a === 0 || // "this" network
    a === 10 ||
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, incl. cloud metadata endpoints
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224 // multicast and reserved
  );
}

function isPrivateIPv6(ip) {
  if (ip === '::' || ip === '::1') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(ip)) return true; // unique local fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(ip)) return true; // link-local fe80::/10

  // IPv4-mapped (::ffff:7f00:1): judge the embedded IPv4 address.
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (mapped) {
    const high = parseInt(mapped[1] ?? '0', 16);
    const low = parseInt(mapped[2] ?? '0', 16);
    return isPrivateIPv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  return false;
}
