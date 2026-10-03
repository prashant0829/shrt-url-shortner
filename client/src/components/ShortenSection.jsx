import { useState } from 'react';
import { getErrorMessage } from '../api/client.js';
import { MAX_ALIAS_LENGTH, QR_PREVIEW_SIZE } from '../constants.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLinksContext } from '../context/LinksContext.jsx';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard.js';

// The creation form and, after a link is made, its short URL and QR code.
export function ShortenSection() {
  const { api, user } = useAuth();
  const links = useLinksContext();
  const copyToClipboard = useCopyToClipboard();

  const [url, setUrl] = useState('');
  const [alias, setAlias] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [createdLink, setCreatedLink] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setCreatedLink(null);
    setBusy(true);

    const payload = { url: url.trim() };
    if (alias.trim()) payload.customAlias = alias.trim();
    if (expiresAt) payload.expiresAt = new Date(expiresAt).toISOString();

    try {
      const link = await api.createLink(payload);
      setCreatedLink(link);
      // Start the next link from a clean form (an alias can only be used once).
      setUrl('');
      setAlias('');
      setExpiresAt('');
      if (user) {
        // While a search filter is active the new link may not match it, so reload instead.
        if (links.query) links.refresh();
        else links.add(link);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card hero" aria-labelledby="hero-title">
      <h1 id="hero-title">Shorten a link</h1>
      <p className="muted">
        Paste a long URL, get a short one. Sign in to manage links and see analytics.
      </p>

      <form onSubmit={handleSubmit} noValidate>
        <label htmlFor="url">Destination URL</label>
        <div className="row">
          <input
            id="url"
            type="url"
            inputMode="url"
            placeholder="https://example.com/a/very/long/link"
            autoComplete="off"
            required
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          <button className="btn primary" type="submit" disabled={busy}>
            Shorten
          </button>
        </div>

        <details>
          <summary>Options</summary>
          <div className="grid2">
            <label>
              Custom alias
              <input
                placeholder="my-link"
                autoComplete="off"
                maxLength={MAX_ALIAS_LENGTH}
                value={alias}
                onChange={(event) => setAlias(event.target.value)}
              />
            </label>
            <label>
              Expires
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
              />
            </label>
          </div>
        </details>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>

      {createdLink && (
        <div className="result">
          <img
            src={api.qrUrl(createdLink.code)}
            alt={`QR code for ${createdLink.shortUrl}`}
            width={QR_PREVIEW_SIZE}
            height={QR_PREVIEW_SIZE}
          />
          <div className="result-main">
            <a
              className="short-url"
              href={createdLink.shortUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {createdLink.shortUrl}
            </a>
            <div className="muted">
              {user
                ? 'Saved to your links.'
                : 'Sign in next time to track clicks and manage your links.'}
            </div>
            <button
              className="btn small copy"
              type="button"
              onClick={() => copyToClipboard(createdLink.shortUrl)}
            >
              Copy link
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
