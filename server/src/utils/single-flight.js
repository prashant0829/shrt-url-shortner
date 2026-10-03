// Concurrent calls with the same key share one execution, so a burst of identical lookups
// reaches the database once instead of once per caller.
export function createSingleFlight() {
  const pendingByKey = new Map();

  function run(key, task) {
    const pending = pendingByKey.get(key);
    if (pending) return pending;

    const promise = task().finally(() => pendingByKey.delete(key));
    pendingByKey.set(key, promise);
    return promise;
  }

  return { run };
}
