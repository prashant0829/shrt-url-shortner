import Bowser from 'bowser';
import { isbot } from 'isbot';
import { DeviceType, WEB_PROTOCOLS } from '../constants.js';

const KNOWN_DEVICE_TYPES = new Set([
  DeviceType.DESKTOP,
  DeviceType.MOBILE,
  DeviceType.TABLET,
  DeviceType.TV,
]);

// Turns a raw click event into the dimensions we report on. Pure, so it is easy to test.
export function enrichClick(event) {
  const userAgent = event.userAgent ?? '';
  const parsedAgent = userAgent ? Bowser.parse(userAgent) : undefined;
  const platformType = parsedAgent?.platform.type;

  return {
    eventId: event.eventId,
    linkId: event.linkId,
    occurredAt: new Date(event.occurredAt),
    visitorHash: event.visitorHash,
    country: event.country,
    referrerHost: extractHost(event.referrer),
    browser: parsedAgent?.browser.name ?? null,
    os: parsedAgent?.os.name ?? null,
    deviceType: KNOWN_DEVICE_TYPES.has(platformType) ? platformType : DeviceType.UNKNOWN,
    // Real browsers always send a user agent, so a missing one is treated as automation.
    isBot: userAgent === '' || isbot(userAgent),
  };
}

// Only the host is kept: full referrer URLs vary endlessly and may contain personal data.
function extractHost(referrer) {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    if (!WEB_PROTOCOLS.includes(url.protocol)) return null;
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}
