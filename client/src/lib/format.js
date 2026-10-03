import { AnalyticsInterval, LinkStatus } from '../constants.js';

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE;
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const relativeTimeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export const formatDateTime = (iso) => dateTimeFormat.format(new Date(iso));

// "3 hours ago", "in 2 days", "just now".
export function timeAgo(iso, now = Date.now()) {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  const units = [
    ['day', SECONDS_PER_DAY],
    ['hour', SECONDS_PER_HOUR],
    ['minute', SECONDS_PER_MINUTE],
  ];

  for (const [unit, secondsPerUnit] of units) {
    if (Math.abs(seconds) >= secondsPerUnit) {
      return relativeTimeFormat.format(Math.round(seconds / secondsPerUnit), unit);
    }
  }
  return 'just now';
}

// The state a link is in, for the badge next to it.
export function linkStatus(link, now = Date.now()) {
  if (!link.isActive) return { key: LinkStatus.DISABLED, label: 'Disabled' };
  if (link.expiresAt && new Date(link.expiresAt).getTime() <= now) {
    return { key: LinkStatus.EXPIRED, label: 'Expired' };
  }
  return { key: LinkStatus.ACTIVE, label: 'Active' };
}

export const stripProtocol = (url) => url.replace(/^https?:\/\//, '');

export const pluralize = (count, singular, plural = `${singular}s`) =>
  `${count.toLocaleString()} ${count === 1 ? singular : plural}`;

// Days are bucketed in UTC on the server, so they are labelled in UTC too (otherwise viewers west
// of UTC would see the previous day). Hours use the viewer's clock.
export function bucketLabel(iso, interval) {
  const date = new Date(iso);
  return interval === AnalyticsInterval.HOUR
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
