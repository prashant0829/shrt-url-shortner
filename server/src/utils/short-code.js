import { randomBytes } from 'node:crypto';
import { RESERVED_SHORT_CODES, SHORT_CODE_LENGTH, SHORT_CODE_PATTERN } from '../constants.js';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const DISTINCT_BYTE_VALUES = 256;

// Bytes at or above this limit are discarded. Below it, every character of the alphabet is hit by
// the same number of byte values, so no character is more likely than another (no modulo bias).
const UNBIASED_BYTE_LIMIT = Math.floor(DISTINCT_BYTE_VALUES / ALPHABET.length) * ALPHABET.length;

const reservedCodes = new Set(RESERVED_SHORT_CODES);

export const isValidShortCode = (code) => SHORT_CODE_PATTERN.test(code);

export const isReservedShortCode = (code) => reservedCodes.has(code.toLowerCase());

// A random base62 code from a cryptographically secure source: unguessable, and API replicas need
// no coordination because the database enforces uniqueness.
export function generateShortCode(length = SHORT_CODE_LENGTH) {
  let code = '';
  while (code.length < length) {
    for (const byte of randomBytes((length - code.length) * 2)) {
      if (byte < UNBIASED_BYTE_LIMIT && code.length < length) {
        code += ALPHABET[byte % ALPHABET.length];
      }
    }
  }
  return code;
}
