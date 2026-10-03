import { useState } from 'react';
import { getErrorMessage } from '../api/client.js';
import { AsyncStatus, ToastKind } from '../constants.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLinksContext } from '../context/LinksContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard.js';
import { ConfirmDialog } from './ConfirmDialog.jsx';
import { LinkRow } from './LinkRow.jsx';

// The signed-in user's links: search, copy, enable/disable, delete (with confirmation) and paging.
export function LinksSection({ onOpenAnalytics }) {
  const { api } = useAuth();
  const showToast = useToast();
  const links = useLinksContext();
  const copyToClipboard = useCopyToClipboard();
  const [linkPendingDelete, setLinkPendingDelete] = useState(null);

  async function toggleActive(link) {
    try {
      const updated = await api.updateLink(link.code, { isActive: !link.isActive });
      links.replace(updated);
      showToast(updated.isActive ? 'Link enabled' : 'Link disabled');
    } catch (err) {
      showToast(getErrorMessage(err), ToastKind.ERROR);
    }
  }

  async function confirmDelete() {
    const link = linkPendingDelete;
    setLinkPendingDelete(null);
    try {
      await api.deleteLink(link.code);
      links.remove(link.code);
      showToast('Link deleted');
    } catch (err) {
      showToast(getErrorMessage(err), ToastKind.ERROR);
    }
  }

  async function loadMore() {
    try {
      await links.loadMore();
    } catch (err) {
      showToast(getErrorMessage(err), ToastKind.ERROR);
    }
  }

  const isEmpty = links.status === AsyncStatus.READY && links.items.length === 0;

  return (
    <section className="card" aria-labelledby="links-title">
      <div className="section-head">
        <h2 id="links-title">Your links</h2>
        <input
          type="search"
          placeholder="Search links"
          aria-label="Search links"
          value={links.searchText}
          onChange={(event) => links.setSearchText(event.target.value)}
        />
      </div>

      {links.status === AsyncStatus.ERROR && (
        <p className="error" role="alert">
          {getErrorMessage(links.error)}{' '}
          <button className="btn small" type="button" onClick={links.refresh}>
            Retry
          </button>
        </p>
      )}

      <div className="links" aria-busy={links.status === AsyncStatus.LOADING}>
        {links.items.map((link) => (
          <LinkRow
            key={link.code}
            link={link}
            onCopy={(copiedLink) => copyToClipboard(copiedLink.shortUrl)}
            onAnalytics={onOpenAnalytics}
            onToggle={toggleActive}
            onDelete={setLinkPendingDelete}
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
        open={linkPendingDelete !== null}
        title="Delete this link?"
        message={
          linkPendingDelete
            ? `${linkPendingDelete.shortUrl} will stop working. The address stays reserved and cannot be reused.`
            : ''
        }
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setLinkPendingDelete(null)}
      />
    </section>
  );
}
