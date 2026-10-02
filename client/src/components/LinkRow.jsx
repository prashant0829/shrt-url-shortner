import { formatDateTime, linkStatus, pluralize, stripProtocol, timeAgo } from '../lib/format.js';

/**
 * One link in the list. Every value is rendered as text, so a hostile destination URL or alias
 * cannot inject markup.
 *
 * @param {object} props
 * @param {object} props.link A link as returned by the API.
 * @param {(link: object) => void} props.onCopy
 * @param {(link: object) => void} props.onAnalytics
 * @param {(link: object) => void} props.onToggle
 * @param {(link: object) => void} props.onDelete
 */
export function LinkRow({ link, onCopy, onAnalytics, onToggle, onDelete }) {
  const status = linkStatus(link);

  return (
    <article className="link">
      <div className="link-main">
        <div className="link-title">
          <a href={link.shortUrl} target="_blank" rel="noopener noreferrer">
            {stripProtocol(link.shortUrl)}
          </a>
          <button
            className="btn small"
            type="button"
            aria-label={`Copy ${link.shortUrl}`}
            onClick={() => onCopy(link)}
          >
            Copy
          </button>
        </div>
        <div className="dest" title={link.originalUrl}>
          {link.originalUrl}
        </div>
        <div className="meta">
          <span className={`badge ${status.key}`}>{status.label}</span>
          <span>{pluralize(link.clickCount, 'click')}</span>
          <span title={formatDateTime(link.createdAt)}>Created {timeAgo(link.createdAt)}</span>
          {link.expiresAt && <span>Expires {formatDateTime(link.expiresAt)}</span>}
        </div>
      </div>
      <div className="actions">
        <button
          className="btn small"
          type="button"
          aria-label={`Analytics for ${link.code}`}
          onClick={() => onAnalytics(link)}
        >
          Analytics
        </button>
        <button
          className="btn small"
          type="button"
          aria-label={`${link.isActive ? 'Disable' : 'Enable'} ${link.code}`}
          onClick={() => onToggle(link)}
        >
          {link.isActive ? 'Disable' : 'Enable'}
        </button>
        <button
          className="btn small danger"
          type="button"
          aria-label={`Delete ${link.code}`}
          onClick={() => onDelete(link)}
        >
          Delete
        </button>
      </div>
    </article>
  );
}
