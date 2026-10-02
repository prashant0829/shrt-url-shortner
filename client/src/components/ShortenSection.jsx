import { useState } from 'react';
import { describeError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLinksContext } from '../context/LinksContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { copyText } from '../lib/clipboard.js';

/** The hero card: the creation form and, after a link is made, its short URL and QR code. */
export function ShortenSection() {
  const { api, user } = useAuth();
  const links = useLinksContext();
  const toast = useToast();

  const [url, setUrl] = useState('');
  const [alias, setAlias] = useState('');
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setCreated(null);
    setBusy(true);

    const payload = { url: url.trim() };
    if (alias.trim()) payload.customAlias = alias.trim();
    if (expires) payload.expiresAt = new Date(expires).toISOString();

    try {
      const link = await api.createLink(payload);
      setCreated(link);
      // Start the next link from a clean form (an alias can only be used once).
      setUrl('');
      setAlias('');
      setExpires('');
      if (user) {
        // While a search filter is active the new link may not match it: reload instead.
        if (links.query) links.refresh();
        else links.add(link);
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    const copied = await copyText(created.shortUrl);
    toast(
      copied
        ? 'Copied to clipboard'
        : 'Could not copy automatically. Select the link and copy it manually.',
      copied ? 'info' : 'error',
    );
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
            onChange={(e) => setUrl(e.target.value)}
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
                maxLength={32}
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
              />
            </label>
            <label>
              Expires
              <input
                type="datetime-local"
                value={expires}
                onChange={(e) => setExpires(e.target.value)}
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

      {created && (
        <div className="result">
          <img
            src={api.qrUrl(created.code)}
            alt={`QR code for ${created.shortUrl}`}
            width="96"
            height="96"
          />
          <div className="result-main">
            <a
              className="short-url"
              href={created.shortUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {created.shortUrl}
            </a>
            <div className="muted">
              {user
                ? 'Saved to your links.'
                : 'Sign in next time to track clicks and manage your links.'}
            </div>
            <button className="btn small copy" type="button" onClick={handleCopy}>
              Copy link
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
