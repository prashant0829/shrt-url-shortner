import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { CacheControl, HttpHeader } from '../constants.js';

const FINGERPRINTED_ASSET_MAX_AGE = '1y';

// Serves the built React app: index.html at `/`, bundles under /assets, and any other top-level
// file (favicon, ...) at its own path. Returns null when the UI has not been built.
//
// Top-level files are registered one by one at start-up instead of mounting a static middleware on
// `/`: the redirect route is `/:code`, and a static mount would hit the disk on every short-link click.
export function createUiRouter({ webDir, logger }) {
  const indexFile = path.join(webDir, 'index.html');
  if (!fs.existsSync(indexFile)) {
    logger.warn({ webDir }, 'UI build not found; serving the API only (run `npm run build`)');
    return null;
  }

  const router = express.Router();

  // Vite puts a hash in bundle file names, so they can be cached forever.
  router.use(
    '/assets',
    express.static(path.join(webDir, 'assets'), {
      index: false,
      immutable: true,
      maxAge: FINGERPRINTED_ASSET_MAX_AGE,
    }),
  );

  // The HTML page is always revalidated so a new deploy is picked up.
  router.get('/', (_req, res) => {
    res.set(HttpHeader.CACHE_CONTROL, CacheControl.REVALIDATE).sendFile(indexFile);
  });

  for (const entry of fs.readdirSync(webDir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name === 'index.html') continue;

    router.get(`/${entry.name}`, (_req, res) => {
      res
        .set(HttpHeader.CACHE_CONTROL, CacheControl.PUBLIC_ONE_HOUR)
        .sendFile(path.join(webDir, entry.name));
    });
  }
  return router;
}
