import Bowser from 'bowser';
import { isbot } from 'isbot';

const DEVICE_TYPES = new Set(['desktop', 'mobile', 'tablet', 'tv']);

/** Turns a raw click into the dimensions we report on. Pure, so it is trivial to test. */
export function enrichClick(event) {
  const userAgent = event.userAgent ?? '';
  const parsed = userAgent ? Bowser.parse(userAgent) : undefined;
  const platform = parsed?.platform.type;

  return {
    eventId: event.eventId,
    linkId: event.linkId,
    occurredAt: new Date(event.occurredAt),
    visitorHash: event.visitorHash,
    country: event.country,
    referrerHost: extractHost(event.referrer),
    browser: parsed?.browser.name ?? null,
    os: parsed?.os.name ?? null,
    deviceType: platform && DEVICE_TYPES.has(platform) ? platform : 'unknown',
    // Real browsers always send a user agent, so a missing one is treated as automation.
    isBot: userAgent === '' || isbot(userAgent),
  };
}

/** Only the host is kept: full referrer URLs are high-cardinality and may contain personal data. */
function extractHost(referrer) {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}
