const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export const formatDateTime = (iso) => dateTime.format(new Date(iso));

/** "3 hours ago", "in 2 days", "just now". */
export function timeAgo(iso, now = Date.now()) {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  for (const [unit, size] of [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ]) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

/** The state a link is in, for the badge next to it. */
export function linkStatus(link, now = Date.now()) {
  if (!link.isActive) return { key: 'disabled', label: 'Disabled' };
  if (link.expiresAt && new Date(link.expiresAt).getTime() <= now) {
    return { key: 'expired', label: 'Expired' };
  }
  return { key: 'active', label: 'Active' };
}

export const stripProtocol = (url) => url.replace(/^https?:\/\//, '');

export const pluralize = (count, singular, plural = `${singular}s`) =>
  `${count.toLocaleString()} ${count === 1 ? singular : plural}`;

/**
 * Label for a chart bucket. Days are bucketed in UTC on the server, so they are labelled in UTC
 * too (otherwise viewers west of UTC would see the previous day); hours use the viewer's clock.
 */
export function bucketLabel(iso, interval) {
  const date = new Date(iso);
  return interval === 'hour'
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
