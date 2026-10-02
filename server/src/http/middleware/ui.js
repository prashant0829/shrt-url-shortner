import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

/**
 * Serves the built React app: `index.html` at `/`, hashed bundles under `/assets`, and any other
 * top-level file (favicon, ...) at its own path.
 *
 * Top-level files are registered one by one at start-up instead of mounting a static middleware
 * on `/`. The redirect route is `/:code`, and a static mount would `stat()` the disk on every
 * short-link click just to learn that `public/<code>` does not exist.
 *
 * @param {{webDir: string, logger: import('pino').Logger}} options
 * @returns {import('express').Router | null} `null` when the UI has not been built.
 */
export function createUiRouter({ webDir, logger }) {
  const indexFile = path.join(webDir, 'index.html');
  if (!fs.existsSync(indexFile)) {
    logger.warn({ webDir }, 'UI build not found; serving the API only (run `npm run build`)');
    return null;
  }

  const router = express.Router();

  // Vite fingerprints bundle names, so they can be cached forever.
  router.use(
    '/assets',
    express.static(path.join(webDir, 'assets'), { index: false, immutable: true, maxAge: '1y' }),
  );

  // The HTML shell must always be revalidated so a new deploy is picked up.
  router.get('/', (_req, res) => {
    res.set('cache-control', 'no-cache').sendFile(indexFile);
  });

  for (const entry of fs.readdirSync(webDir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name === 'index.html') continue;
    router.get(`/${entry.name}`, (_req, res) => {
      res.set('cache-control', 'public, max-age=3600').sendFile(path.join(webDir, entry.name));
    });
  }
  return router;
}
