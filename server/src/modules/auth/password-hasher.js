import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * @typedef {object} PasswordHasher
 * @property {(plain: string) => Promise<string>} hash
 * @property {(plain: string, stored: string) => Promise<boolean>} verify
 */

/**
 * @typedef {object} ScryptParams
 * @property {number} N CPU/memory cost (power of two).
 * @property {number} r
 * @property {number} p
 */

/** OWASP-recommended scrypt setting with ~32 MiB of memory per hash: N=2^15, r=8, p=3. */
const DEFAULT_PARAMS = { N: 2 ** 15, r: 8, p: 3 };
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const FORMAT_PREFIX = 'scrypt';

/** Node's default maxmem (32 MiB) is exactly at the limit for the parameters above. */
const MAX_MEMORY = 128 * 1024 * 1024;

const deriveKey = (password, salt, keyLength, { N, r, p }) =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, { N, r, p, maxmem: MAX_MEMORY }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });

/**
 * scrypt via node:crypto: memory-hard like argon2, but with no native dependency to compile.
 * Hashes are self-describing (`scrypt$N$r$p$salt$hash`), so the cost can be raised later while
 * old hashes keep verifying.
 */
/** @implements {PasswordHasher} */
export class ScryptPasswordHasher {
  #params;

  /** @param {Partial<ScryptParams>} [params] */
  constructor(params = {}) {
    this.#params = { ...DEFAULT_PARAMS, ...params };
  }

  async hash(plain) {
    const salt = randomBytes(SALT_LENGTH);
    const key = await deriveKey(plain, salt, KEY_LENGTH, this.#params);
    const { N, r, p } = this.#params;
    return [FORMAT_PREFIX, N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
  }

  async verify(plain, stored) {
    const [prefix, N, r, p, salt, hash] = stored.split('$');
    if (prefix !== FORMAT_PREFIX || !N || !r || !p || !salt || !hash) return false;

    const expected = Buffer.from(hash, 'base64');
    const actual = await deriveKey(plain, Buffer.from(salt, 'base64'), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
    return timingSafeEqual(actual, expected);
  }
}
