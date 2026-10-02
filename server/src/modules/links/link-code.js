import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** 62^7 ≈ 3.5 trillion combinations: collisions stay rare and are resolved by retrying. */
export const GENERATED_CODE_LENGTH = 7;

/** Shape shared by generated codes and custom aliases (mirrors the CHECK constraint on `links`). */
export const CODE_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;

/** Paths the application serves itself, plus words that would look official. */
const RESERVED_CODES = new Set([
  'api',
  'docs',
  'health',
  'metrics',
  'assets',
  'static',
  'admin',
  'login',
  'logout',
  'register',
  'signup',
  'app',
  'www',
]);

export const isValidCode = (code) => CODE_PATTERN.test(code);

export const isReservedCode = (code) => RESERVED_CODES.has(code.toLowerCase());

/**
 * Random base62 code from a CSPRNG. Being random (not sequential) makes codes unguessable and
 * needs no coordination between instances; uniqueness is enforced by the database.
 */
export function generateCode(length = GENERATED_CODE_LENGTH) {
  let code = '';
  while (code.length < length) {
    for (const byte of randomBytes((length - code.length) * 2)) {
      // 248 = 4 * 62: discarding larger bytes removes modulo bias so every character is equally likely.
      if (byte < 248 && code.length < length) code += ALPHABET.charAt(byte % 62);
    }
  }
  return code;
}
