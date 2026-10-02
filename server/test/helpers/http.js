import request from 'supertest';

// Collects the raw response bytes, whatever the content type (JSON, PNG, HTML...).
const collectBuffer = (res, callback) => {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};

/**
 * Gives an Express app an `inject()` method for tests: one call in, one plain response object out.
 *
 *   const res = await app.inject({ method: 'POST', url: '/x', headers, payload, remoteAddress });
 *   res.statusCode, res.headers, res.body (string), res.rawPayload (Buffer), res.json()
 *
 * It is a thin layer over supertest, so tests exercise the real middleware stack over HTTP without
 * leaving a server listening. `remoteAddress` simulates a client IP through X-Forwarded-For, which
 * the app honours when TRUST_PROXY_HOPS is 1 (the default for the test environment).
 *
 * @param {import('express').Express} app
 */
export function withInject(app) {
  app.inject = async ({ method = 'GET', url, headers = {}, payload, remoteAddress }) => {
    let req = request(app)[method.toLowerCase()](url);
    for (const [name, value] of Object.entries(headers)) req = req.set(name, value);
    if (remoteAddress) req = req.set('x-forwarded-for', remoteAddress);
    if (payload !== undefined) req = req.send(payload);

    const res = await req.buffer(true).parse(collectBuffer);
    const rawPayload = res.body;
    const body = rawPayload.toString('utf8');
    return {
      statusCode: res.status,
      headers: res.headers,
      rawPayload,
      body,
      json: () => JSON.parse(body),
    };
  };
  return app;
}
