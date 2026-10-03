import http from 'node:http';
import request from 'supertest';

const LOOPBACK = '127.0.0.1';

// Collects the raw response bytes, whatever the content type (JSON, PNG, HTML...).
const collectBuffer = (res, callback) => {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};

// Starts a server for `app` on a free port of 127.0.0.1 only. Binding every interface (what
// supertest does by default) lets another program that listens on the same port of 127.0.0.1,
// such as an editor or a desktop app, answer the request instead of this app.
export async function listenOnLoopback(app) {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, LOOPBACK, resolve);
  });
  return server;
}

export async function closeServer(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

// Gives an Express app an `inject()` method for tests: one call in, one plain response object out.
//
//   const res = await app.inject({ method: 'POST', url: '/x', headers, payload, remoteAddress });
//   res.statusCode, res.headers, res.body (string), res.rawPayload (Buffer), res.json()
//
// It is a thin layer over supertest, so tests exercise the real middleware stack over HTTP.
// `remoteAddress` simulates a client IP through X-Forwarded-For, which the app honours when
// TRUST_PROXY_HOPS is 1 (the default for the test environment).
export function withInject(app) {
  app.inject = async ({ method = 'GET', url, headers = {}, payload, remoteAddress }) => {
    const server = await listenOnLoopback(app);
    try {
      let req = request(server)[method.toLowerCase()](url);
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
    } finally {
      await closeServer(server);
    }
  };
  return app;
}
