/** An error response from the API: `{ error: { code, message, details } }`. */
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message ?? `Request failed (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error?.code;
    this.details = body?.error?.details;
  }
}

// Error codes that mean "your session is no longer valid" (as opposed to a wrong password).
const SESSION_ERROR_CODES = new Set(['TOKEN_EXPIRED', 'INVALID_TOKEN']);

/**
 * A small typed-by-convention wrapper around `fetch` for the URL shortener API.
 * It has no React dependency, so it can be tested (and reused) on its own.
 *
 * @param {object} options
 * @param {() => string | null} options.getToken Read on every request, so a new login is picked up immediately.
 * @param {() => void} [options.onSessionExpired] Called when the server says the token is invalid or expired.
 * @param {string} [options.baseUrl]
 * @param {typeof fetch} [options.fetchFn] Injected in tests.
 */
export function createApiClient({
  getToken,
  onSessionExpired,
  baseUrl = '/api/v1',
  fetchFn = (...args) => fetch(...args),
}) {
  async function request(path, { method = 'GET', body, auth = true, signal } = {}) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    const token = auth ? getToken() : null;
    if (token) headers.authorization = `Bearer ${token}`;

    const response = await fetchFn(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    if (response.status === 204) return null;

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new ApiError(response.status, data);
      if (token && SESSION_ERROR_CODES.has(error.code)) onSessionExpired?.();
      throw error;
    }
    return data;
  }

  const encode = encodeURIComponent;

  return {
    register: (email, password) =>
      request('/auth/register', { method: 'POST', body: { email, password }, auth: false }),
    login: (email, password) =>
      request('/auth/login', { method: 'POST', body: { email, password }, auth: false }),
    me: (options) => request('/auth/me', options),

    createLink: (payload) => request('/links', { method: 'POST', body: payload }),
    listLinks: ({ limit, cursor, q } = {}, options) => {
      const params = new URLSearchParams();
      if (limit) params.set('limit', String(limit));
      if (cursor) params.set('cursor', cursor);
      if (q) params.set('q', q);
      return request(`/links?${params}`, options);
    },
    updateLink: (code, patch) =>
      request(`/links/${encode(code)}`, { method: 'PATCH', body: patch }),
    deleteLink: (code) => request(`/links/${encode(code)}`, { method: 'DELETE' }),

    getAnalytics: (code, { from, to, interval, includeBots }, options) => {
      const params = new URLSearchParams({ interval, includeBots: String(includeBots) });
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      return request(`/links/${encode(code)}/analytics?${params}`, options);
    },

    /** URL of the QR code image (a plain `<img src>`: the endpoint is public). */
    qrUrl: (code, size = 240) => `${baseUrl}/links/${encode(code)}/qr?size=${size}`,
  };
}

/** A message fit for showing to a person. */
export function describeError(err) {
  if (err instanceof ApiError && err.code === 'VALIDATION_ERROR' && Array.isArray(err.details)) {
    return err.details.map((d) => (d.path ? `${d.path}: ${d.message}` : d.message)).join('. ');
  }
  return err instanceof Error ? err.message : 'Something went wrong';
}
