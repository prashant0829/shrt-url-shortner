import { beforeEach, describe, expect, it } from 'vitest';
import { LinkService } from '../../src/modules/links/link.service.js';
import { UrlPolicy } from '../../src/modules/links/url-policy.js';
import { InMemoryLinkCache, InMemoryLinkStore, TEST_URL_POLICY } from '../helpers/fakes.js';

const NOW = new Date('2026-06-01T12:00:00Z');

describe('LinkService', () => {
  let store;
  let cache;
  let codes;

  const build = () =>
    new LinkService({
      links: store,
      cache,
      urlPolicy: new UrlPolicy(TEST_URL_POLICY),
      generateCode: () => codes.shift() ?? 'FALLBK1',
      now: () => NOW,
    });

  beforeEach(() => {
    store = new InMemoryLinkStore();
    cache = new InMemoryLinkCache();
    codes = [];
  });

  describe('create', () => {
    it('stores the normalised URL under a generated code and warms the cache', async () => {
      codes = ['abc1234'];
      const link = await build().create({ url: 'https://Example.com/x', userId: 'u1' });

      expect(link).toMatchObject({
        code: 'abc1234',
        originalUrl: 'https://example.com/x',
        userId: 'u1',
      });
      expect(cache.entries.get('abc1234')).toMatchObject({
        url: 'https://example.com/x',
        isActive: true,
      });
    });

    it('retries when a generated code is already taken', async () => {
      codes = ['taken00', 'taken00', 'fresh11'];
      const service = build();
      await service.create({ url: 'https://a.com', userId: null });

      const second = await service.create({ url: 'https://b.com', userId: null });
      expect(second.code).toBe('fresh11');
    });

    it('gives up with 503 after repeated collisions', async () => {
      const service = build();
      codes = ['same000'];
      await service.create({ url: 'https://a.com', userId: null });

      codes = Array(10).fill('same000');
      await expect(service.create({ url: 'https://b.com', userId: null })).rejects.toMatchObject({
        statusCode: 503,
        code: 'CODE_GENERATION_FAILED',
      });
    });

    it('never issues a generated code that is reserved', async () => {
      codes = ['metrics', 'goodone'];
      const link = await build().create({ url: 'https://a.com', userId: null });
      expect(link.code).toBe('goodone');
    });

    it('uses a custom alias when given', async () => {
      const link = await build().create({
        url: 'https://a.com',
        customAlias: 'my-blog',
        userId: 'u1',
      });
      expect(link.code).toBe('my-blog');
    });

    it('rejects an alias that is taken, without overwriting the original', async () => {
      const service = build();
      const original = await service.create({
        url: 'https://a.com',
        customAlias: 'promo',
        userId: 'u1',
      });

      await expect(
        service.create({ url: 'https://evil.com', customAlias: 'promo', userId: 'u2' }),
      ).rejects.toMatchObject({ statusCode: 409, code: 'ALIAS_TAKEN' });
      expect(store.links.get('promo')?.originalUrl).toBe(original.originalUrl);
    });

    it.each(['api', 'Docs', 'HEALTH'])('rejects the reserved alias %s', async (alias) => {
      await expect(
        build().create({ url: 'https://a.com', customAlias: alias, userId: null }),
      ).rejects.toMatchObject({ statusCode: 409, code: 'ALIAS_RESERVED' });
    });

    it('rejects URLs that violate the policy before touching storage', async () => {
      await expect(build().create({ url: 'http://localhost', userId: null })).rejects.toMatchObject(
        {
          code: 'INVALID_URL',
        },
      );
      expect(store.links.size).toBe(0);
    });

    it('rejects an expiry in the past', async () => {
      await expect(
        build().create({
          url: 'https://a.com',
          userId: null,
          expiresAt: new Date(NOW.getTime() - 1),
        }),
      ).rejects.toMatchObject({ code: 'INVALID_EXPIRY' });
    });

    it('accepts a future expiry', async () => {
      const expiresAt = new Date(NOW.getTime() + 60_000);
      const link = await build().create({ url: 'https://a.com', userId: null, expiresAt });
      expect(link.expiresAt).toEqual(expiresAt);
    });
  });

  describe('ownership', () => {
    it("hides other users' links behind 404", async () => {
      const service = build();
      const link = await service.create({ url: 'https://a.com', userId: 'owner' });

      await expect(service.getOwned(link.code, 'intruder')).rejects.toMatchObject({
        statusCode: 404,
      });
      await expect(
        service.update(link.code, 'intruder', { isActive: false }),
      ).rejects.toMatchObject({ statusCode: 404 });
      await expect(service.delete(link.code, 'intruder')).rejects.toMatchObject({
        statusCode: 404,
      });
      expect(store.links.get(link.code)?.deletedAt).toBeNull();
    });

    it('treats anonymous links as unmanageable', async () => {
      const service = build();
      const link = await service.create({ url: 'https://a.com', userId: null });
      await expect(service.getOwned(link.code, 'anyone')).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });

  describe('update', () => {
    it('changes the destination and invalidates the cached target', async () => {
      const service = build();
      const link = await service.create({ url: 'https://old.com', userId: 'u1' });
      expect(cache.entries.has(link.code)).toBe(true);

      const updated = await service.update(link.code, 'u1', { url: 'https://new.com' });

      expect(updated.originalUrl).toBe('https://new.com/');
      expect(cache.entries.has(link.code)).toBe(false);
    });

    it('validates the new destination', async () => {
      const service = build();
      const link = await service.create({ url: 'https://a.com', userId: 'u1' });
      await expect(
        service.update(link.code, 'u1', { url: 'http://10.0.0.1' }),
      ).rejects.toMatchObject({
        code: 'INVALID_URL',
      });
    });

    it('can disable a link and clear its expiry', async () => {
      const service = build();
      const link = await service.create({
        url: 'https://a.com',
        userId: 'u1',
        expiresAt: new Date(NOW.getTime() + 60_000),
      });

      const updated = await service.update(link.code, 'u1', { isActive: false, expiresAt: null });

      expect(updated.isActive).toBe(false);
      expect(updated.expiresAt).toBeNull();
    });

    it('leaves the expiry alone when it is not mentioned', async () => {
      const service = build();
      const expiresAt = new Date(NOW.getTime() + 60_000);
      const link = await service.create({ url: 'https://a.com', userId: 'u1', expiresAt });

      const updated = await service.update(link.code, 'u1', { isActive: true });
      expect(updated.expiresAt).toEqual(expiresAt);
    });
  });

  describe('delete', () => {
    it('soft-deletes, keeps the code reserved and invalidates the cache', async () => {
      const service = build();
      const link = await service.create({
        url: 'https://a.com',
        customAlias: 'gone-soon',
        userId: 'u1',
      });

      await service.delete(link.code, 'u1');

      expect(cache.entries.has('gone-soon')).toBe(false);
      await expect(service.getOwned('gone-soon', 'u1')).rejects.toMatchObject({ statusCode: 404 });
      // The code cannot be re-registered by someone else.
      await expect(
        service.create({ url: 'https://other.com', customAlias: 'gone-soon', userId: 'u2' }),
      ).rejects.toMatchObject({ code: 'ALIAS_TAKEN' });
    });
  });

  describe('list', () => {
    const seed = async (service, count, userId = 'u1') => {
      for (let i = 0; i < count; i++) {
        codes = [`code${String(i).padStart(3, '0')}`];
        await service.create({ url: `https://site${i}.com`, userId });
      }
    };

    it('returns newest first and pages through with a cursor', async () => {
      const service = build();
      await seed(service, 5);

      const first = await service.list('u1', { limit: 2 });
      expect(first.items.map((l) => l.code)).toEqual(['code004', 'code003']);
      expect(first.nextCursor).not.toBeNull();

      const second = await service.list('u1', { limit: 2, cursor: first.nextCursor ?? undefined });
      expect(second.items.map((l) => l.code)).toEqual(['code002', 'code001']);

      const third = await service.list('u1', { limit: 2, cursor: second.nextCursor ?? undefined });
      expect(third.items.map((l) => l.code)).toEqual(['code000']);
      expect(third.nextCursor).toBeNull();
    });

    it('reports no next page when the result fits exactly', async () => {
      const service = build();
      await seed(service, 2);
      expect((await service.list('u1', { limit: 2 })).nextCursor).toBeNull();
    });

    it("only lists the caller's own, non-deleted links", async () => {
      const service = build();
      await seed(service, 2, 'u1');
      codes = ['other00'];
      await service.create({ url: 'https://x.com', userId: 'u2' });
      await service.delete('code000', 'u1');

      const page = await service.list('u1', { limit: 10 });
      expect(page.items.map((l) => l.code)).toEqual(['code001']);
    });

    it('filters by search text', async () => {
      const service = build();
      await seed(service, 3);
      const page = await service.list('u1', { limit: 10, search: 'site1' });
      expect(page.items.map((l) => l.originalUrl)).toEqual(['https://site1.com/']);
    });

    it('rejects a malformed cursor', async () => {
      await expect(build().list('u1', { limit: 5, cursor: 'nonsense' })).rejects.toMatchObject({
        code: 'INVALID_CURSOR',
      });
    });
  });
});
