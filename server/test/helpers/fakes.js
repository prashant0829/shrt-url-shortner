// In-memory link store that mirrors the semantics of the Postgres repository.
export function createInMemoryLinkStore() {
  let nextId = 1;

  const store = {
    links: new Map(),
    findCalls: 0,

    async insert(link) {
      if (store.links.has(link.code)) return null;
      const now = new Date();
      const record = {
        id: nextId++,
        ...link,
        isActive: true,
        clickCount: 0,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      store.links.set(record.code, record);
      return { ...record };
    },

    async findByCode(code) {
      store.findCalls += 1;
      const record = store.links.get(code);
      return record ? { ...record } : null;
    },

    async listByUser(params) {
      const search = params.search?.toLowerCase();
      return [...store.links.values()]
        .filter(
          (link) =>
            link.userId === params.userId &&
            link.deletedAt === null &&
            (params.beforeId === undefined || link.id < params.beforeId) &&
            (!search ||
              link.code.toLowerCase().includes(search) ||
              link.originalUrl.toLowerCase().includes(search)),
        )
        .sort((a, b) => b.id - a.id)
        .slice(0, params.limit)
        .map((link) => ({ ...link }));
    },

    async update(code, patch) {
      const record = store.links.get(code);
      if (!record || record.deletedAt !== null) return null;
      if (patch.originalUrl !== undefined) record.originalUrl = patch.originalUrl;
      if (patch.isActive !== undefined) record.isActive = patch.isActive;
      if (patch.expiresAt !== undefined) record.expiresAt = patch.expiresAt;
      record.updatedAt = new Date();
      return { ...record };
    },

    async softDelete(code) {
      const record = store.links.get(code);
      if (!record || record.deletedAt !== null) return false;
      record.deletedAt = new Date();
      return true;
    },
  };

  return store;
}

export function createInMemoryLinkCache() {
  const cache = {
    entries: new Map(),

    async get(code) {
      return cache.entries.has(code) ? cache.entries.get(code) : undefined;
    },

    async set(code, target) {
      cache.entries.set(code, target);
    },

    async delete(code) {
      cache.entries.delete(code);
    },
  };

  return cache;
}

export function createInMemoryUserStore() {
  const store = {
    users: new Map(),

    async create(input) {
      if (await store.findByEmail(input.email)) return null;
      const user = { id: crypto.randomUUID(), ...input, createdAt: new Date() };
      store.users.set(user.id, user);
      return user;
    },

    async findByEmail(email) {
      return (
        [...store.users.values()].find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null
      );
    },

    async findById(id) {
      return store.users.get(id) ?? null;
    },
  };

  return store;
}

// Reads a labelled counter's current value from a prom-client Counter.
export async function counterValue(counter, labels = {}) {
  const { values } = await counter.get();
  return (
    values.find((v) => Object.entries(labels).every(([key, value]) => v.labels[key] === value))
      ?.value ?? 0
  );
}

// A URL policy configuration that accepts ordinary public URLs.
export const TEST_URL_POLICY = { blockedDomains: [], selfHostname: 'short.test' };
