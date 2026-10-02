import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, resetState } from '../helpers/context.js';

// A stand-in for the React build, so these tests do not depend on the client having been built.
let webDir;
let ctx;

beforeAll(async () => {
  webDir = await mkdtemp(path.join(tmpdir(), 'shrt-web-'));
  await mkdir(path.join(webDir, 'assets'));
  await writeFile(
    path.join(webDir, 'index.html'),
    '<!doctype html><title>shrt</title><div id="root"></div>',
  );
  await writeFile(path.join(webDir, 'assets', 'app-abc123.js'), 'console.log("ui")');
  await writeFile(path.join(webDir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  ctx = await createTestContext({ WEB_DIR: webDir });
});

afterAll(async () => {
  await ctx.close();
  await rm(webDir, { recursive: true, force: true });
});

describe('serving the React build', () => {
  it('serves the HTML shell at the root and always revalidates it', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.body).toContain('<title>shrt</title>');
  });

  it('serves fingerprinted bundles with long-lived immutable caching', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/assets/app-abc123.js' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('javascript');
    expect(res.headers['cache-control']).toContain('max-age=31536000');
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('serves other top-level files such as the favicon', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/favicon.svg' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
  });

  it('answers unknown assets with the standard JSON 404', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/assets/missing.js' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('is served under a policy that only allows same-origin scripts', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/' });
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
  });

  it('does not let the UI routes shadow short links', async () => {
    await resetState();
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/links',
      payload: { url: 'https://example.com', customAlias: 'assets-2' },
    });
    expect(created.statusCode).toBe(201);
    expect((await ctx.app.inject({ method: 'GET', url: '/assets-2' })).statusCode).toBe(302);
  });
});

describe('without a UI build', () => {
  it('still serves the API and reports the root as not found', async () => {
    const apiOnly = await createTestContext({ WEB_DIR: path.join(webDir, 'does-not-exist') });
    try {
      expect((await apiOnly.app.inject({ method: 'GET', url: '/health/live' })).statusCode).toBe(
        200,
      );
      const root = await apiOnly.app.inject({ method: 'GET', url: '/' });
      expect(root.statusCode).toBe(404);
      expect(root.json().error.code).toBe('ROUTE_NOT_FOUND');
    } finally {
      await apiOnly.close();
    }
  });
});
