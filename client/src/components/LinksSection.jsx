import { useState } from 'react';
import { describeError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLinksContext } from '../context/LinksContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { copyText } from '../lib/clipboard.js';
import { ConfirmDialog } from './ConfirmDialog.jsx';
import { LinkRow } from './LinkRow.jsx';

/**
 * The signed-in user's links: search, copy, enable/disable, delete (with confirmation), paging.
 * @param {{onOpenAnalytics: (link: object) => void}} props
 */
export function LinksSection({ onOpenAnalytics }) {
  const { api } = useAuth();
  const toast = useToast();
  const links = useLinksContext();
  const [pendingDelete, setPendingDelete] = useState(null);

  async function copy(link) {
    const copied = await copyText(link.shortUrl);
    toast(
      copied
        ? 'Copied to clipboard'
        : 'Could not copy automatically. Select the link and copy it manually.',
      copied ? 'info' : 'error',
    );
  }

  async function toggle(link) {
    try {
      const updated = await api.updateLink(link.code, { isActive: !link.isActive });
      links.replace(updated);
      toast(updated.isActive ? 'Link enabled' : 'Link disabled');
    } catch (err) {
      toast(describeError(err), 'error');
    }
  }

  async function confirmDelete() {
    const link = pendingDelete;
    setPendingDelete(null);
    try {
      await api.deleteLink(link.code);
      links.remove(link.code);
      toast('Link deleted');
    } catch (err) {
      toast(describeError(err), 'error');
    }
  }

  async function loadMore() {
    try {
      await links.loadMore();
    } catch (err) {
      toast(describeError(err), 'error');
    }
  }

  const isEmpty = links.status === 'ready' && links.items.length === 0;

  return (
    <section className="card" aria-labelledby="links-title">
      <div className="section-head">
        <h2 id="links-title">Your links</h2>
        <input
          type="search"
          placeholder="Search links"
          aria-label="Search links"
          value={links.searchText}
          onChange={(e) => links.setSearchText(e.target.value)}
        />
      </div>

      {links.status === 'error' && (
        <p className="error" role="alert">
          {describeError(links.error)}{' '}
          <button className="btn small" type="button" onClick={links.refresh}>
            Retry
          </button>
        </p>
      )}

      <div className="links" aria-busy={links.status === 'loading'}>
        {links.items.map((link) => (
          <LinkRow
            key={link.code}
            link={link}
            onCopy={copy}
            onAnalytics={onOpenAnalytics}
            onToggle={toggle}
            onDelete={setPendingDelete}
          />
        ))}
      </div>

      {isEmpty && (
        <p className="muted">
          {links.query
            ? 'No links match your search.'
            : 'No links yet. Create your first one above.'}
        </p>
      )}

      {links.hasMore && (
        <button
          id="load-more"
          className="btn"
          type="button"
          onClick={loadMore}
          disabled={links.loadingMore}
        >
          Load more
        </button>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this link?"
        message={
          pendingDelete
            ? `${pendingDelete.shortUrl} will stop working. The address stays reserved and cannot be reused.`
            : ''
        }
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
}
