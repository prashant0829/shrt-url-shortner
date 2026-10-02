/** In-memory LinkStore that mirrors the semantics of the Postgres implementation. */
export class InMemoryLinkStore {
  links = new Map();
  findCalls = 0;
  #nextId = 1;

  async insert(link) {
    if (this.links.has(link.code)) return null;
    const now = new Date();
    const record = {
      id: this.#nextId++,
      ...link,
      isActive: true,
      clickCount: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.links.set(record.code, record);
    return { ...record };
  }

  async findByCode(code) {
    this.findCalls += 1;
    const record = this.links.get(code);
    return record ? { ...record } : null;
  }

  async listByUser(params) {
    const search = params.search?.toLowerCase();
    return [...this.links.values()]
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
  }

  async update(code, patch) {
    const record = this.links.get(code);
    if (!record || record.deletedAt !== null) return null;
    if (patch.originalUrl !== undefined) record.originalUrl = patch.originalUrl;
    if (patch.isActive !== undefined) record.isActive = patch.isActive;
    if (patch.expiresAt !== undefined) record.expiresAt = patch.expiresAt;
    record.updatedAt = new Date();
    return { ...record };
  }

  async softDelete(code) {
    const record = this.links.get(code);
    if (!record || record.deletedAt !== null) return false;
    record.deletedAt = new Date();
    return true;
  }
}

export class InMemoryLinkCache {
  entries = new Map();

  async get(code) {
    return this.entries.has(code) ? this.entries.get(code) : undefined;
  }

  async set(code, target) {
    this.entries.set(code, target);
  }

  async delete(code) {
    this.entries.delete(code);
  }
}

export class InMemoryUserStore {
  users = new Map();

  async create(input) {
    if (await this.findByEmail(input.email)) return null;
    const user = { id: crypto.randomUUID(), ...input, createdAt: new Date() };
    this.users.set(user.id, user);
    return user;
  }

  async findByEmail(email) {
    return (
      [...this.users.values()].find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null
    );
  }

  async findById(id) {
    return this.users.get(id) ?? null;
  }
}

/** Reads a labelled counter's current value from a prom-client Counter. */
export async function counterValue(counter, labels = {}) {
  const { values } = await counter.get();
  return (
    values.find((v) => Object.entries(labels).every(([key, value]) => v.labels[key] === value))
      ?.value ?? 0
  );
}

/** A URL policy configuration that accepts ordinary public URLs. */
export const TEST_URL_POLICY = { blockedDomains: [], selfHostname: 'short.test' };
