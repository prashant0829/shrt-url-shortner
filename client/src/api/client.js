import {
  API_BASE_URL,
  ApiErrorCode,
  DEFAULT_QR_SIZE,
  HttpHeader,
  HttpStatus,
  JSON_CONTENT_TYPE,
  SESSION_ERROR_CODES,
} from '../constants.js';

// An error response from the API: `{ error: { code, message, details } }`.
export function createApiError(status, body) {
  const error = new Error(body?.error?.message ?? `Request failed (${status})`);
  error.name = 'ApiError';
  error.status = status;
  error.code = body?.error?.code;
  error.details = body?.error?.details;
  return error;
}

export const isApiError = (value) => value instanceof Error && value.name === 'ApiError';

// A thin wrapper around `fetch` for the API, with no React dependency.
// `getToken` is read on every request, so a new login is picked up immediately.
// `onSessionExpired` runs when the server says the token is invalid or expired.
export function createApiClient({
  getToken,
  onSessionExpired,
  baseUrl = API_BASE_URL,
  fetchFn = (...args) => fetch(...args),
}) {
  async function request(path, { method = 'GET', body, auth = true, signal } = {}) {
    const headers = {};
    if (body !== undefined) headers[HttpHeader.CONTENT_TYPE] = JSON_CONTENT_TYPE;
    const token = auth ? getToken() : null;
    if (token) headers[HttpHeader.AUTHORIZATION] = `Bearer ${token}`;

    const response = await fetchFn(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    if (response.status === HttpStatus.NO_CONTENT) return null;

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = createApiError(response.status, data);
      if (token && SESSION_ERROR_CODES.includes(error.code)) onSessionExpired?.();
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

    // A plain `<img src>` works because the QR endpoint is public.
    qrUrl: (code, size = DEFAULT_QR_SIZE) => `${baseUrl}/links/${encode(code)}/qr?size=${size}`,
  };
}

// A message fit for showing to a person.
export function getErrorMessage(error) {
  const isValidationError =
    isApiError(error) &&
    error.code === ApiErrorCode.VALIDATION_ERROR &&
    Array.isArray(error.details);

  if (isValidationError) {
    return error.details
      .map((detail) => (detail.path ? `${detail.path}: ${detail.message}` : detail.message))
      .join('. ');
  }
  return error instanceof Error ? error.message : 'Something went wrong';
}
