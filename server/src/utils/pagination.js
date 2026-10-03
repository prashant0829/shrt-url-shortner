import { ErrorCode } from '../constants.js';
import { badRequestError } from '../errors.js';

// Keyset pagination: the cursor is the id of the last row on the previous page. Unlike OFFSET, the
// cost of a page does not grow with how deep the client has paged.
export const encodeCursor = (id) => Buffer.from(String(id)).toString('base64url');

export function decodeCursor(cursor) {
  const decoded = Buffer.from(cursor, 'base64url').toString();
  const id = Number(decoded);
  if (!/^\d+$/.test(decoded) || !Number.isSafeInteger(id)) {
    throw badRequestError(ErrorCode.INVALID_CURSOR, 'The pagination cursor is not valid');
  }
  return id;
}
