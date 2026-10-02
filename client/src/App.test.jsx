import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { errorBody, makeLink, makeReport, makeSession } from './test/fakeApi.js';
import { renderApp } from './test/renderApp.jsx';

const ME = { 'GET /auth/me': { body: { user: makeSession().user } } };
const list = (items, nextCursor = null) => ({ body: { items, nextCursor } });

describe('shortening a link', () => {
  const createdLink = makeLink({ code: 'abc1234', shortUrl: 'http://short.test/abc1234' });

  it('shortens a link anonymously and shows the short URL with its QR code', async () => {
    const { user, api } = renderApp({
      routes: { 'POST /links': { status: 201, body: createdLink } },
    });

    await user.type(screen.getByLabelText('Destination URL'), 'https://example.com/long/path');
    await user.click(screen.getByRole('button', { name: 'Shorten' }));

    const link = await screen.findByRole('link', { name: 'http://short.test/abc1234' });
    expect(link).toHaveAttribute('href', 'http://short.test/abc1234');
    expect(screen.getByAltText('QR code for http://short.test/abc1234')).toHaveAttribute(
      'src',
      '/api/v1/links/abc1234/qr?size=240',
    );
    expect(screen.getByText(/sign in next time/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Destination URL')).toHaveValue('');
    expect(api.callsTo('POST', '/links')[0].body).toEqual({ url: 'https://example.com/long/path' });
    expect(api.callsTo('POST', '/links')[0].headers.authorization).toBeUndefined();
  });

  it('sends the custom alias and expiry when the options are filled in', async () => {
    const { user, api } = renderApp({
      routes: { 'POST /links': { status: 201, body: createdLink } },
    });

    await user.type(screen.getByLabelText('Destination URL'), 'https://example.com');
    await user.click(screen.getByText('Options'));
    await user.type(screen.getByLabelText('Custom alias'), 'my-link');
    fireEvent.change(screen.getByLabelText('Expires'), { target: { value: '2030-01-01T10:30' } });
    await user.click(screen.getByRole('button', { name: 'Shorten' }));

    await screen.findByText('http://short.test/abc1234');
    // The options are cleared after success, so the next link does not reuse the alias.
    expect(screen.getByLabelText('Custom alias')).toHaveValue('');
    expect(screen.getByLabelText('Expires')).toHaveValue('');
    expect(api.callsTo('POST', '/links')[0].body).toEqual({
      url: 'https://example.com',
      customAlias: 'my-link',
      expiresAt: new Date('2030-01-01T10:30').toISOString(),
    });
  });

  it("shows the API's message when the link is refused, and clears it on the next attempt", async () => {
    let attempt = 0;
    const { user } = renderApp({
      routes: {
        'POST /links': () =>
          ++attempt === 1
            ? {
                status: 400,
                body: errorBody(
                  'INVALID_URL',
                  'URLs pointing to private or local addresses are not allowed',
                ),
              }
            : { status: 201, body: createdLink },
      },
    });

    await user.type(screen.getByLabelText('Destination URL'), 'http://169.254.169.254');
    await user.click(screen.getByRole('button', { name: 'Shorten' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('private or local addresses');

    await user.clear(screen.getByLabelText('Destination URL'));
    await user.type(screen.getByLabelText('Destination URL'), 'https://example.com');
    await user.click(screen.getByRole('button', { name: 'Shorten' }));

    await screen.findByText('http://short.test/abc1234');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('turns validation errors into readable field messages', async () => {
    const { user } = renderApp({
      routes: {
        'POST /links': {
          status: 400,
          body: errorBody('VALIDATION_ERROR', 'Request validation failed', [
            { in: 'body', path: 'customAlias', message: '3-32 characters' },
          ]),
        },
      },
    });

    await user.type(screen.getByLabelText('Destination URL'), 'https://example.com');
    await user.click(screen.getByRole('button', { name: 'Shorten' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('customAlias: 3-32 characters');
  });

  it('prevents double submission while a request is in flight', async () => {
    let release;
    const { user, api } = renderApp({
      routes: {
        'POST /links': () =>
          new Promise((resolve) => {
            release = () => resolve({ status: 201, body: createdLink });
          }),
      },
    });

    await user.type(screen.getByLabelText('Destination URL'), 'https://example.com');
    await user.click(screen.getByRole('button', { name: 'Shorten' }));

    expect(screen.getByRole('button', { name: 'Shorten' })).toBeDisabled();
    release();
    await screen.findByText('http://short.test/abc1234');
    expect(api.callsTo('POST', '/links')).toHaveLength(1);
  });
});

describe('accounts', () => {
  it('signs up through the dialog, then loads and shows the new account’s links', async () => {
    const { user, api } = renderApp({
      routes: {
        'POST /auth/register': { status: 201, body: makeSession('new@example.com', 'tok-new') },
        'GET /links': list([
          makeLink({ code: 'first-link', shortUrl: 'http://short.test/first-link' }),
        ]),
      },
    });
    expect(screen.queryByRole('heading', { name: 'Your links' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    const dialog = screen.getByRole('dialog', { name: 'Sign in' });
    await user.click(within(dialog).getByRole('button', { name: 'Need an account? Sign up' }));
    expect(screen.getByRole('dialog', { name: 'Create account' })).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Email'), 'new@example.com');
    await user.type(within(dialog).getByLabelText('Password'), 'a-good-password');
    await user.click(within(dialog).getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { name: 'Your links' })).toBeInTheDocument();
    expect(screen.getByText('new@example.com')).toBeInTheDocument();
    expect(await screen.findByText('short.test/first-link')).toBeInTheDocument();
    expect(screen.getByText('Account created')).toBeInTheDocument();

    expect(api.callsTo('POST', '/auth/register')[0].body).toEqual({
      email: 'new@example.com',
      password: 'a-good-password',
    });
    expect(api.callsTo('GET', '/links')[0].headers.authorization).toBe('Bearer tok-new');
    expect(localStorage.getItem('shrt.token')).toBe('tok-new');
  });

  it('signs in, and shows the error when the credentials are wrong', async () => {
    let attempt = 0;
    const { user } = renderApp({
      routes: {
        'POST /auth/login': () =>
          ++attempt === 1
            ? { status: 401, body: errorBody('INVALID_CREDENTIALS', 'Invalid email or password') }
            : { status: 200, body: makeSession() },
        'GET /links': list([]),
      },
    });

    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    const dialog = screen.getByRole('dialog', { name: 'Sign in' });
    await user.type(within(dialog).getByLabelText('Email'), 'demo@example.com');
    await user.type(within(dialog).getByLabelText('Password'), 'wrong-password');
    await user.click(within(dialog).getByRole('button', { name: 'Sign in' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(dialog).toHaveAttribute('open'); // stays open so the person can try again

    await user.clear(within(dialog).getByLabelText('Password'));
    await user.type(within(dialog).getByLabelText('Password'), 'right-password');
    await user.click(within(dialog).getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('demo@example.com')).toBeInTheDocument();
    await waitFor(() => expect(dialog).not.toHaveAttribute('open'));
  });

  it('can be cancelled', async () => {
    const { user } = renderApp();

    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    const dialog = screen.getByRole('dialog', { name: 'Sign in' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(dialog).not.toHaveAttribute('open');
  });

  it('restores a saved session on start', async () => {
    const { api } = renderApp({
      token: 'saved-token',
      routes: { ...ME, 'GET /links': list([makeLink()]) },
    });

    expect(await screen.findByText('demo@example.com')).toBeInTheDocument();
    expect(await screen.findByText('short.test/abc1234')).toBeInTheDocument();
    expect(api.callsTo('GET', '/auth/me')[0].headers.authorization).toBe('Bearer saved-token');
  });

  it('signs the user out, with an explanation, when the saved session has expired', async () => {
    renderApp({
      token: 'stale-token',
      routes: {
        'GET /auth/me': {
          status: 401,
          body: errorBody('TOKEN_EXPIRED', 'The access token has expired'),
        },
      },
    });

    expect(await screen.findByText(/session has expired/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(localStorage.getItem('shrt.token')).toBeNull();
  });

  it('signs out', async () => {
    const { user } = renderApp({ token: 't', routes: { ...ME, 'GET /links': list([makeLink()]) } });
    await screen.findByText('short.test/abc1234');

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText('short.test/abc1234')).not.toBeInTheDocument();
    expect(localStorage.getItem('shrt.token')).toBeNull();
  });

  it('adds a link created while signed in to the top of the list', async () => {
    const existing = makeLink({ code: 'older', shortUrl: 'http://short.test/older' });
    const fresh = makeLink({ code: 'fresh', shortUrl: 'http://short.test/fresh' });
    const { user, api } = renderApp({
      token: 't',
      routes: {
        ...ME,
        'GET /links': list([existing]),
        'POST /links': { status: 201, body: fresh },
      },
    });
    await screen.findByText('short.test/older');

    await user.type(screen.getByLabelText('Destination URL'), 'https://example.com/new');
    await user.click(screen.getByRole('button', { name: 'Shorten' }));

    await waitFor(() => {
      const rows = screen.getAllByRole('article');
      expect(rows[0]).toHaveTextContent('short.test/fresh');
      expect(rows[1]).toHaveTextContent('short.test/older');
    });
    expect(screen.getByText('Saved to your links.')).toBeInTheDocument();
    expect(api.callsTo('POST', '/links')[0].headers.authorization).toBe('Bearer t');
  });
});

describe('managing links', () => {
  const links = [
    makeLink({ code: 'alpha', shortUrl: 'http://short.test/alpha', clickCount: 1 }),
    makeLink({ code: 'beta', shortUrl: 'http://short.test/beta', isActive: false, clickCount: 0 }),
    makeLink({
      code: 'gamma',
      shortUrl: 'http://short.test/gamma',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    }),
  ];
  const signedIn = (routes = {}) =>
    renderApp({ token: 't', routes: { ...ME, 'GET /links': list(links), ...routes } });
  const rowFor = (code) => screen.getByText(`short.test/${code}`).closest('article');

  it('shows each link with its status, click count and actions', async () => {
    signedIn();
    await screen.findByText('short.test/alpha');

    expect(within(rowFor('alpha')).getByText('Active')).toBeInTheDocument();
    expect(within(rowFor('alpha')).getByText('1 click')).toBeInTheDocument();
    expect(within(rowFor('beta')).getByText('Disabled')).toBeInTheDocument();
    expect(within(rowFor('beta')).getByRole('button', { name: 'Enable beta' })).toBeInTheDocument();
    expect(within(rowFor('gamma')).getByText('Expired')).toBeInTheDocument();
  });

  it('disables and re-enables a link', async () => {
    const { user, api } = signedIn({
      'PATCH /links/alpha': ({ body }) => ({ body: { ...links[0], isActive: body.isActive } }),
    });
    await screen.findByText('short.test/alpha');

    await user.click(screen.getByRole('button', { name: 'Disable alpha' }));

    expect(await screen.findByText('Link disabled')).toBeInTheDocument();
    expect(within(rowFor('alpha')).getByText('Disabled')).toBeInTheDocument();
    expect(api.callsTo('PATCH', '/links/alpha')[0].body).toEqual({ isActive: false });

    await user.click(screen.getByRole('button', { name: 'Enable alpha' }));
    expect(await screen.findByText('Link enabled')).toBeInTheDocument();
    expect(within(rowFor('alpha')).getByText('Active')).toBeInTheDocument();
  });

  it('reports a failed update and leaves the list alone', async () => {
    const { user } = signedIn({
      'PATCH /links/alpha': { status: 404, body: errorBody('LINK_NOT_FOUND', 'Link not found') },
    });
    await screen.findByText('short.test/alpha');

    await user.click(screen.getByRole('button', { name: 'Disable alpha' }));

    expect(await screen.findByText('Link not found')).toBeInTheDocument();
    expect(within(rowFor('alpha')).getByText('Active')).toBeInTheDocument();
  });

  it('asks for confirmation before deleting, and deletes when confirmed', async () => {
    const { user, api } = signedIn({ 'DELETE /links/alpha': { status: 204 } });
    await screen.findByText('short.test/alpha');

    await user.click(screen.getByRole('button', { name: 'Delete alpha' }));
    const confirm = screen.getByRole('dialog', { name: 'Delete this link?' });
    expect(confirm).toHaveTextContent('http://short.test/alpha will stop working');
    expect(api.callsTo('DELETE', '/links/alpha')).toHaveLength(0); // nothing happens until confirmed

    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByText('short.test/alpha')).not.toBeInTheDocument());
    expect(screen.getByText('Link deleted')).toBeInTheDocument();
    expect(api.callsTo('DELETE', '/links/alpha')).toHaveLength(1);
  });

  it('does nothing when the deletion is cancelled', async () => {
    const { user, api } = signedIn();
    await screen.findByText('short.test/alpha');

    await user.click(screen.getByRole('button', { name: 'Delete alpha' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete this link?' })).getByRole('button', {
        name: 'Cancel',
      }),
    );

    expect(screen.getByText('short.test/alpha')).toBeInTheDocument();
    expect(api.callsTo('DELETE', '/links/alpha')).toHaveLength(0);
  });

  it('copies the short URL', async () => {
    const { user } = signedIn();
    await screen.findByText('short.test/alpha');

    await user.click(screen.getByRole('button', { name: 'Copy http://short.test/alpha' }));

    expect(await screen.findByText('Copied to clipboard')).toBeInTheDocument();
    // user-event provides a working clipboard stub for the page.
    expect(await navigator.clipboard.readText()).toBe('http://short.test/alpha');
  });

  it('searches with a short delay and shows the filtered results', async () => {
    const { user, api } = signedIn();
    await screen.findByText('short.test/alpha');
    api.calls.length = 0;

    const match = makeLink({ code: 'needle', shortUrl: 'http://short.test/needle' });
    api.fetchFn.mockImplementation(async (input) => {
      const url = new URL(input, 'http://localhost');
      api.calls.push({
        method: 'GET',
        path: '/links',
        query: Object.fromEntries(url.searchParams),
        headers: {},
      });
      const items = url.searchParams.get('q') === 'needle' ? [match] : links;
      return new Response(JSON.stringify({ items, nextCursor: null }), { status: 200 });
    });

    await user.type(screen.getByLabelText('Search links'), 'needle');

    await screen.findByText('short.test/needle');
    expect(screen.queryByText('short.test/alpha')).not.toBeInTheDocument();
    // One request for the final text, not one per keystroke.
    expect(api.callsTo('GET', '/links')).toHaveLength(1);
    expect(api.callsTo('GET', '/links')[0].query.q).toBe('needle');
  });

  it('says so when a search finds nothing, and when there are no links at all', async () => {
    const { user } = renderApp({ token: 't', routes: { ...ME, 'GET /links': list([]) } });
    expect(
      await screen.findByText('No links yet. Create your first one above.'),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText('Search links'), 'zzz');
    expect(await screen.findByText('No links match your search.')).toBeInTheDocument();
  });

  it('loads more pages on request and hides the button at the end', async () => {
    const page1 = [makeLink({ code: 'one', shortUrl: 'http://short.test/one' })];
    const page2 = [makeLink({ code: 'two', shortUrl: 'http://short.test/two' })];
    const { user, api } = renderApp({
      token: 't',
      routes: {
        ...ME,
        'GET /links': ({ query }) => (query.cursor ? list(page2) : list(page1, 'cursor-1')),
      },
    });
    await screen.findByText('short.test/one');

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    await screen.findByText('short.test/two');
    expect(screen.getByText('short.test/one')).toBeInTheDocument();
    expect(api.callsTo('GET', '/links').at(-1).query.cursor).toBe('cursor-1');
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('offers a retry when the list fails to load', async () => {
    let attempt = 0;
    const { user } = renderApp({
      token: 't',
      routes: {
        ...ME,
        'GET /links': () =>
          ++attempt === 1
            ? { status: 500, body: errorBody('INTERNAL_ERROR', 'An unexpected error occurred') }
            : list([makeLink()]),
      },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('An unexpected error occurred');
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('short.test/abc1234')).toBeInTheDocument();
  });
});

describe('analytics', () => {
  const openAnalytics = async (routes = {}) => {
    const rendered = renderApp({
      token: 't',
      routes: { ...ME, 'GET /links': list([makeLink()]), ...routes },
    });
    await screen.findByText('short.test/abc1234');
    await rendered.user.click(screen.getByRole('button', { name: 'Analytics for abc1234' }));
    return rendered;
  };

  it('shows totals, a chart and the breakdowns for the default 7-day range', async () => {
    const { api } = await openAnalytics({ 'GET /links/abc1234/analytics': { body: makeReport() } });

    const dialog = screen.getByRole('dialog', { name: /Analytics/ });
    expect(await within(dialog).findByText('482')).toBeInTheDocument();
    expect(within(dialog).getByText('197')).toBeInTheDocument();
    expect(within(dialog).getByRole('img', { name: '482 clicks over 8 days' })).toBeInTheDocument();
    for (const label of ['US', 'Chrome', 'Linux', 'desktop', 'Direct']) {
      expect(within(dialog).getByText(label)).toBeInTheDocument();
    }
    expect(within(dialog).getByText('Days are counted in UTC.')).toBeInTheDocument();

    const call = api.callsTo('GET', '/links/abc1234/analytics')[0];
    expect(call.query).toMatchObject({ interval: 'day', includeBots: 'false' });
    const span = Date.parse(call.query.to) - Date.parse(call.query.from);
    expect(span).toBe(7 * 86_400_000);
    expect(call.headers.authorization).toBe('Bearer t');
  });

  it('refetches with hourly buckets for 24 hours, and with bots when asked', async () => {
    const { user, api } = await openAnalytics({
      'GET /links/abc1234/analytics': { body: makeReport() },
    });
    const dialog = screen.getByRole('dialog', { name: /Analytics/ });
    await within(dialog).findByText('482');

    await user.click(within(dialog).getByRole('button', { name: '24 hours' }));
    await waitFor(() =>
      expect(api.callsTo('GET', '/links/abc1234/analytics').at(-1).query.interval).toBe('hour'),
    );
    expect(within(dialog).getByRole('button', { name: '24 hours' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(dialog).getByRole('button', { name: '7 days' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    await user.click(within(dialog).getByLabelText('Include bots'));
    await waitFor(() =>
      expect(api.callsTo('GET', '/links/abc1234/analytics').at(-1).query.includeBots).toBe('true'),
    );
  });

  it('shows the error when the report cannot be loaded', async () => {
    await openAnalytics({
      'GET /links/abc1234/analytics': {
        status: 404,
        body: errorBody('LINK_NOT_FOUND', 'Link not found'),
      },
    });

    expect(
      await within(screen.getByRole('dialog', { name: /Analytics/ })).findByRole('alert'),
    ).toHaveTextContent('Link not found');
  });

  it('shows "No data yet" for empty breakdowns', async () => {
    const empty = makeReport({
      totals: { clicks: 0, uniqueVisitors: 0 },
      breakdowns: { countries: [], browsers: [], operatingSystems: [], devices: [], referrers: [] },
    });
    await openAnalytics({ 'GET /links/abc1234/analytics': { body: empty } });

    const dialog = screen.getByRole('dialog', { name: /Analytics/ });
    await within(dialog).findAllByText('No data yet');
    expect(within(dialog).getAllByText('No data yet')).toHaveLength(5);
  });

  it('closes, and starts fresh the next time it is opened', async () => {
    const { user } = await openAnalytics({
      'GET /links/abc1234/analytics': { body: makeReport() },
    });
    const dialog = screen.getByRole('dialog', { name: /Analytics/ });
    await within(dialog).findByText('482');
    await user.click(within(dialog).getByRole('button', { name: '30 days' }));

    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(dialog).not.toHaveAttribute('open');

    await user.click(screen.getByRole('button', { name: 'Analytics for abc1234' }));
    expect(
      within(screen.getByRole('dialog', { name: /Analytics/ })).getByRole('button', {
        name: '7 days',
      }),
    ).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('safety', () => {
  it('shows hostile link data as plain text, never as markup', async () => {
    const hostile = makeLink({
      code: 'evil',
      shortUrl: 'http://short.test/evil',
      originalUrl: '<img src=x onerror="window.__pwned = true">',
    });
    renderApp({ token: 't', routes: { ...ME, 'GET /links': list([hostile]) } });

    expect(
      await screen.findByText('<img src=x onerror="window.__pwned = true">'),
    ).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(window.__pwned).toBeUndefined();
  });

  it('opens external links safely', async () => {
    renderApp({ token: 't', routes: { ...ME, 'GET /links': list([makeLink()]) } });
    const link = await screen.findByRole('link', { name: 'short.test/abc1234' });

    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });
});
