import { isIP } from 'node:net';
import { ErrorCode, MAX_URL_LENGTH, WEB_PROTOCOLS } from '../constants.js';
import { badRequestError } from '../errors.js';

const LOCAL_HOST_SUFFIXES = ['.localhost', '.local', '.internal'];

const invalidUrl = (message) => badRequestError(ErrorCode.INVALID_URL, message);

function isPrivateHost(host) {
  if (host === 'localhost' || LOCAL_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return true;
  }

  // The URL parser turns 2130706433, 0x7f.1 and 017700000001 into dotted-quad form.
  if (isIP(host) === 4) return isPrivateIPv4(host);

  if (host.startsWith('[') && host.endsWith(']')) return isPrivateIPv6(host.slice(1, -1));

  // A public hostname has at least two labels; "intranet" or "router" do not.
  return !host.includes('.');
}

function isPrivateIPv4(ip) {
  const [firstOctet = 0, secondOctet = 0] = ip.split('.').map(Number);
  return (
    firstOctet === 0 || // "this" network
    firstOctet === 10 ||
    firstOctet === 127 || // loopback
    (firstOctet === 100 && secondOctet >= 64 && secondOctet <= 127) || // carrier-grade NAT
    (firstOctet === 169 && secondOctet === 254) || // link-local, including cloud metadata endpoints
    (firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31) ||
    (firstOctet === 192 && secondOctet === 168) ||
    firstOctet >= 224 // multicast and reserved
  );
}

function isPrivateIPv6(ip) {
  if (ip === '::' || ip === '::1') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(ip)) return true; // unique local fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(ip)) return true; // link-local fe80::/10

  // IPv4-mapped (::ffff:7f00:1): judge the embedded IPv4 address.
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (mapped) {
    const upperHalf = parseInt(mapped[1] ?? '0', 16);
    const lowerHalf = parseInt(mapped[2] ?? '0', 16);
    return isPrivateIPv4(
      `${upperHalf >> 8}.${upperHalf & 0xff}.${lowerHalf >> 8}.${lowerHalf & 0xff}`,
    );
  }
  return false;
}

// Decides which destinations may be shortened. A shortener redirects strangers on the owner's
// behalf, so it must not become a way to reach internal networks, to phish with embedded
// credentials, or to create redirect loops.
//
// Subdomains of a blocked domain are blocked too. `selfHostname` is this service's own host.
export function createUrlPolicy({ blockedDomains, selfHostname }) {
  const blocked = blockedDomains.map((domain) => domain.toLowerCase().replace(/^\./, ''));
  const ownHostname = selfHostname.toLowerCase();

  const isBlocked = (host) =>
    blocked.some((domain) => host === domain || host.endsWith(`.${domain}`));

  // Returns the canonical form of `rawUrl` or throws an INVALID_URL error.
  function normalize(rawUrl) {
    const input = rawUrl.trim();
    if (input.length > MAX_URL_LENGTH) {
      throw invalidUrl(`URL is too long (max ${MAX_URL_LENGTH} characters)`);
    }

    let url;
    try {
      url = new URL(input);
    } catch {
      throw invalidUrl('Not a valid absolute URL');
    }

    if (!WEB_PROTOCOLS.includes(url.protocol)) {
      throw invalidUrl('Only http and https URLs can be shortened');
    }
    if (url.username || url.password) {
      throw invalidUrl('URLs with embedded credentials are not allowed');
    }

    const host = url.hostname.toLowerCase();
    if (isPrivateHost(host)) {
      throw invalidUrl('URLs pointing to private or local addresses are not allowed');
    }
    if (host === ownHostname) throw invalidUrl('Links to this service cannot be shortened');
    if (isBlocked(host)) throw invalidUrl('This domain is not allowed');

    return url.href;
  }

  return { normalize };
}
