/**
 * Collapses concurrent calls that share a key into one in-flight execution.
 * Protects the database from a cache stampede: N simultaneous misses for the same short code
 * trigger a single query instead of N.
 */
export class SingleFlight {
  #inflight = new Map();

  run(key, task) {
    const existing = this.#inflight.get(key);
    if (existing) return existing;

    const promise = task().finally(() => this.#inflight.delete(key));
    this.#inflight.set(key, promise);
    return promise;
  }
}
