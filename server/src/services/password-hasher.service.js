import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// scrypt settings recommended by OWASP (about 32 MiB per hash). N is the CPU/memory cost, r the
// block size and p the parallelism.
const DEFAULT_SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 3 };
const KEY_LENGTH_BYTES = 32;
const SALT_LENGTH_BYTES = 16;
const HASH_FORMAT_PREFIX = 'scrypt';

// Node's default memory limit (32 MiB) is exactly at the limit for the parameters above.
const SCRYPT_MAX_MEMORY_BYTES = 128 * 1024 * 1024;

const deriveKey = (password, salt, keyLength, { N, r, p }) =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, { N, r, p, maxmem: SCRYPT_MAX_MEMORY_BYTES }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });

// scrypt through node:crypto: memory-hard like argon2, with nothing native to compile. A stored hash
// describes itself (`scrypt$N$r$p$salt$hash`), so the cost can be raised later while old hashes
// keep verifying.
export function createScryptPasswordHasher(params = {}) {
  const scryptParams = { ...DEFAULT_SCRYPT_PARAMS, ...params };

  async function hash(plainPassword) {
    const salt = randomBytes(SALT_LENGTH_BYTES);
    const key = await deriveKey(plainPassword, salt, KEY_LENGTH_BYTES, scryptParams);
    const { N, r, p } = scryptParams;
    return [HASH_FORMAT_PREFIX, N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
  }

  async function verify(plainPassword, storedHash) {
    const [prefix, N, r, p, salt, hash] = storedHash.split('$');
    if (prefix !== HASH_FORMAT_PREFIX || !N || !r || !p || !salt || !hash) return false;

    const expectedKey = Buffer.from(hash, 'base64');
    const actualKey = await deriveKey(
      plainPassword,
      Buffer.from(salt, 'base64'),
      expectedKey.length,
      { N: Number(N), r: Number(r), p: Number(p) },
    );
    return timingSafeEqual(actualKey, expectedKey);
  }

  return { hash, verify };
}
